//! Works out how many limited units an operation asks for, before it runs.

use std::collections::BTreeMap;

use hive_router::query_planner::ast::selection_item::SelectionItem;
use hive_router::query_planner::ast::selection_set::SelectionSet;

use super::rules::{Rule, RuleSet};

/// What one request wants from one limited field.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Demand {
    pub type_name: String,
    pub field_name: String,
    /// Occurrences of the field in the operation times the rule's `cost`.
    pub units: u32,
    pub rule: Rule,
}

/// Walks the selection tree, tracking the parent type, and totals the cost per limited
/// field. Every selection it is given counts (aliases, fields inside fragments); the size
/// of any list a field returns does not. The router has already merged fields that share
/// a response key, so those arrive, and cost, once. `@skip` and `@include` are ignored on
/// purpose: counting a field that ends up skipped errs on the safe side.
pub fn demands(selection_set: &SelectionSet, root_type: &str, rules: &RuleSet) -> Vec<Demand> {
    let mut totals: BTreeMap<(String, String), Demand> = BTreeMap::new();
    walk(selection_set, root_type, rules, &mut totals);
    totals.into_values().collect()
}

fn walk(
    selection_set: &SelectionSet,
    parent_type: &str,
    rules: &RuleSet,
    totals: &mut BTreeMap<(String, String), Demand>,
) {
    for item in &selection_set.items {
        match item {
            SelectionItem::Field(field) => {
                if let Some(rule) = rules.rule(parent_type, &field.name) {
                    let demand = totals
                        .entry((parent_type.to_string(), field.name.clone()))
                        .or_insert_with(|| Demand {
                            type_name: parent_type.to_string(),
                            field_name: field.name.clone(),
                            units: 0,
                            rule: *rule,
                        });
                    demand.units = demand.units.saturating_add(rule.cost);
                }
                if let Some(child_type) = rules.field_type(parent_type, &field.name) {
                    walk(&field.selections, child_type, rules, totals);
                }
            }
            SelectionItem::InlineFragment(fragment) => {
                walk(
                    &fragment.selections,
                    &fragment.type_condition,
                    rules,
                    totals,
                );
            }
            // The router expands named fragments before this hook runs. If one ever
            // arrives, its fields would go uncounted, so say so loudly instead.
            SelectionItem::FragmentSpread(name) => {
                hive_router::tracing::warn!(
                    fragment = %name,
                    "rate_limit: unexpanded fragment spread, its fields are not counted"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hive_router::graphql_tools::parser::{
        parse_query, parse_schema, query::Definition, query::OperationDefinition,
    };
    use hive_router::graphql_tools::static_graphql::schema::Document;

    fn rules() -> RuleSet {
        let document: Document = parse_schema::<String>(
            r#"
            type Query {
              products: [Product!]! @rateLimit(limit: 5, windowSeconds: 10)
              node(id: ID!): Node
              plain: Int
            }
            type Mutation { addReview: Review! @rateLimit(limit: 2, windowSeconds: 10, cost: 2) }
            interface Node { id: ID! }
            type Product implements Node { id: ID! reviews: [Review!]! @rateLimit(limit: 20, windowSeconds: 10) }
            type Review implements Node { id: ID! product: Product! }
            "#,
        )
        .unwrap()
        .into_static();
        RuleSet::from_document(&document).unwrap()
    }

    fn selection_of(query: &str) -> SelectionSet {
        let document = parse_query::<String>(query).unwrap();
        match document.definitions.into_iter().next().unwrap() {
            Definition::Operation(OperationDefinition::SelectionSet(set)) => set.into(),
            Definition::Operation(OperationDefinition::Query(query)) => query.selection_set.into(),
            Definition::Operation(OperationDefinition::Mutation(mutation)) => {
                mutation.selection_set.into()
            }
            _ => panic!("expected an operation"),
        }
    }

    fn units(query: &str, root: &str) -> Vec<(String, u32)> {
        demands(&selection_of(query), root, &rules())
            .into_iter()
            .map(|demand| {
                (
                    format!("{}.{}", demand.type_name, demand.field_name),
                    demand.units,
                )
            })
            .collect()
    }

    #[test]
    fn counts_a_single_use_as_one_unit() {
        assert_eq!(
            units("{ products { id } }", "Query"),
            vec![("Query.products".into(), 1)]
        );
    }

    #[test]
    fn ignores_unlimited_fields() {
        assert!(units("{ plain }", "Query").is_empty());
    }

    #[test]
    fn counts_every_selection_it_is_given() {
        // (In the router, same-key duplicates are merged before this point; aliases are not.)
        let counted = units(
            "{ a: products { id } b: products { id } products { id } }",
            "Query",
        );
        assert_eq!(counted, vec![("Query.products".into(), 3)]);
    }

    #[test]
    fn applies_the_rule_cost_per_occurrence() {
        assert_eq!(
            units(
                "mutation { a: addReview { id } b: addReview { id } }",
                "Mutation"
            ),
            vec![("Mutation.addReview".into(), 4)]
        );
    }

    #[test]
    fn does_not_scale_with_list_size_or_nesting_depth() {
        let counted = units(
            "{ products { reviews { product { reviews { id } } } } }",
            "Query",
        );
        assert_eq!(
            counted,
            vec![("Product.reviews".into(), 2), ("Query.products".into(), 1)]
        );
    }

    #[test]
    fn counts_several_limited_fields_in_one_request_independently() {
        let counted = units("{ products { reviews { id } } }", "Query");
        assert_eq!(counted.len(), 2);
    }

    #[test]
    fn follows_inline_fragments_by_type_condition() {
        let counted = units(
            r#"{ node(id: "x") { ... on Product { reviews { id } } ... on Review { id } } }"#,
            "Query",
        );
        assert_eq!(counted, vec![("Product.reviews".into(), 1)]);
    }

    #[test]
    fn counts_fields_that_may_be_skipped() {
        let counted = units(
            "query($s: Boolean!) { products @skip(if: $s) { id } }",
            "Query",
        );
        assert_eq!(counted, vec![("Query.products".into(), 1)]);
    }
}
