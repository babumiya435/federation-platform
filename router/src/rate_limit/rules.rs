//! Reads `@rateLimit` rules out of the supergraph document.
//!
//! The router hands plugins the parsed supergraph every time it loads one, so limits
//! live in the schema and nothing here changes when a limit is added or edited.

use std::collections::HashMap;
use std::time::Duration;

use hive_router::graphql_tools::static_graphql::schema::{
    Definition, Directive, Document, Type, TypeDefinition, Value,
};
use hive_router::query_planner::state::supergraph_state::OperationKind;

pub const DIRECTIVE_NAME: &str = "rateLimit";
const KNOWN_ARGUMENTS: [&str; 3] = ["limit", "windowSeconds", "cost"];
const MAX_WINDOW_SECONDS: i64 = 86_400;

/// One limit: `limit` units per caller per `window`; each use costs `cost` units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rule {
    pub limit: u32,
    pub window: Duration,
    pub cost: u32,
}

/// Everything the plugin needs to know about the graph: the rules, and the return type
/// of every field so a walk through an operation can track the current parent type.
#[derive(Debug, Default)]
pub struct RuleSet {
    rules: HashMap<(String, String), Rule>,
    field_types: HashMap<(String, String), String>,
    query_root: Option<String>,
    mutation_root: Option<String>,
    subscription_root: Option<String>,
}

fn named_type(field_type: &Type) -> &str {
    match field_type {
        Type::NamedType(name) => name,
        Type::ListType(inner) | Type::NonNullType(inner) => named_type(inner),
    }
}

fn integer_argument(directive: &Directive, name: &str) -> Option<Result<i64, ()>> {
    directive
        .arguments
        .iter()
        .find(|(argument_name, _)| argument_name == name)
        .map(|(_, value)| match value {
            Value::Int(number) => number.as_i64().ok_or(()),
            _ => Err(()),
        })
}

fn parse_rule(location: &str, directive: &Directive, problems: &mut Vec<String>) -> Option<Rule> {
    let before = problems.len();

    for (argument_name, _) in &directive.arguments {
        if !KNOWN_ARGUMENTS.contains(&argument_name.as_str()) {
            problems.push(format!(
                "@rateLimit on {location}: unknown argument \"{argument_name}\""
            ));
        }
    }

    let limit = match integer_argument(directive, "limit") {
        Some(Ok(value)) if (1..=i64::from(u32::MAX)).contains(&value) => value,
        _ => {
            problems.push(format!(
                "@rateLimit on {location}: `limit` must be an integer >= 1"
            ));
            0
        }
    };
    let window_seconds = match integer_argument(directive, "windowSeconds") {
        Some(Ok(value)) if (1..=MAX_WINDOW_SECONDS).contains(&value) => value,
        _ => {
            problems.push(format!(
                "@rateLimit on {location}: `windowSeconds` must be an integer from 1 to {MAX_WINDOW_SECONDS}"
            ));
            0
        }
    };
    // `cost` defaults to 1 when the schema leaves it out.
    let cost = match integer_argument(directive, "cost") {
        None => 1,
        Some(Ok(value)) if value >= 1 => value,
        _ => {
            problems.push(format!(
                "@rateLimit on {location}: `cost` must be an integer >= 1"
            ));
            1
        }
    };
    if limit > 0 && cost > limit {
        problems.push(format!(
            "@rateLimit on {location}: `cost` ({cost}) is larger than `limit` ({limit}), so the field could never be called"
        ));
    }

    if problems.len() > before {
        return None;
    }
    Some(Rule {
        limit: limit as u32,
        window: Duration::from_secs(window_seconds as u64),
        cost: cost as u32,
    })
}

impl RuleSet {
    /// Builds the rule set, or returns every problem found so a bad directive can fail
    /// the supergraph load with one complete message.
    pub fn from_document(document: &Document) -> Result<Self, Vec<String>> {
        let mut set = RuleSet::default();
        let mut problems = Vec::new();

        for definition in &document.definitions {
            match definition {
                Definition::SchemaDefinition(schema) => {
                    set.query_root = schema.query.clone();
                    set.mutation_root = schema.mutation.clone();
                    set.subscription_root = schema.subscription.clone();
                }
                Definition::TypeDefinition(TypeDefinition::Object(object)) => {
                    for field in &object.fields {
                        let key = (object.name.clone(), field.name.clone());
                        set.field_types
                            .insert(key.clone(), named_type(&field.field_type).to_string());
                        for directive in
                            field.directives.iter().filter(|d| d.name == DIRECTIVE_NAME)
                        {
                            let location = format!("{}.{}", object.name, field.name);
                            if let Some(rule) = parse_rule(&location, directive, &mut problems) {
                                set.rules.insert(key.clone(), rule);
                            }
                        }
                    }
                }
                Definition::TypeDefinition(TypeDefinition::Interface(interface)) => {
                    for field in &interface.fields {
                        set.field_types.insert(
                            (interface.name.clone(), field.name.clone()),
                            named_type(&field.field_type).to_string(),
                        );
                        if field.directives.iter().any(|d| d.name == DIRECTIVE_NAME) {
                            problems.push(format!(
                                "@rateLimit on {}.{}: not supported on interface fields, put it on the object type",
                                interface.name, field.name
                            ));
                        }
                    }
                }
                _ => {}
            }
        }

        if problems.is_empty() {
            Ok(set)
        } else {
            Err(problems)
        }
    }

    pub fn rule(&self, type_name: &str, field_name: &str) -> Option<&Rule> {
        self.rules
            .get(&(type_name.to_string(), field_name.to_string()))
    }

    /// The type a field returns, with list and non-null wrappers removed.
    pub fn field_type(&self, type_name: &str, field_name: &str) -> Option<&str> {
        self.field_types
            .get(&(type_name.to_string(), field_name.to_string()))
            .map(String::as_str)
    }

    /// The root type an operation starts from (an operation without a kind is a query).
    pub fn root_type(&self, kind: Option<&OperationKind>) -> &str {
        match kind {
            None | Some(OperationKind::Query) => self.query_root.as_deref().unwrap_or("Query"),
            Some(OperationKind::Mutation) => self.mutation_root.as_deref().unwrap_or("Mutation"),
            Some(OperationKind::Subscription) => {
                self.subscription_root.as_deref().unwrap_or("Subscription")
            }
        }
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    pub fn len(&self) -> usize {
        self.rules.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hive_router::graphql_tools::parser::parse_schema;

    fn rules_from(sdl: &str) -> Result<RuleSet, Vec<String>> {
        let document: Document = parse_schema::<String>(sdl).unwrap().into_static();
        RuleSet::from_document(&document)
    }

    #[test]
    fn reads_rules_from_object_fields() {
        let set = rules_from(
            r#"
            schema { query: RootQuery }
            type RootQuery {
              products: [Product!]! @rateLimit(limit: 5, windowSeconds: 10)
              other: Int
            }
            type Product { reviews: [Review!]! @rateLimit(limit: 20, windowSeconds: 60, cost: 2) }
            type Review { id: ID! }
            "#,
        )
        .unwrap();

        assert_eq!(set.len(), 2);
        let rule = set.rule("RootQuery", "products").unwrap();
        assert_eq!(
            (rule.limit, rule.window, rule.cost),
            (5, Duration::from_secs(10), 1)
        );
        assert_eq!(set.rule("Product", "reviews").unwrap().cost, 2);
        assert!(set.rule("RootQuery", "other").is_none());
        assert_eq!(set.field_type("RootQuery", "products"), Some("Product"));
        assert_eq!(set.root_type(None), "RootQuery");
        assert_eq!(set.root_type(Some(&OperationKind::Query)), "RootQuery");
        assert_eq!(set.root_type(Some(&OperationKind::Mutation)), "Mutation");
    }

    #[test]
    fn reports_every_problem_in_one_go() {
        let problems = rules_from(
            r#"
            type Query {
              a: Int @rateLimit(limit: 0, windowSeconds: 10)
              b: Int @rateLimit(limit: 5, windowSeconds: 0)
              c: Int @rateLimit(limit: 5)
              d: Int @rateLimit(limit: 2, windowSeconds: 10, cost: 3)
              e: Int @rateLimit(limit: 5, windowSeconds: 10, burst: 9)
              f: Int @rateLimit(limit: "5", windowSeconds: 10)
            }
            interface Thing { g: Int @rateLimit(limit: 1, windowSeconds: 1) }
            "#,
        )
        .unwrap_err();

        let joined = problems.join("\n");
        for expected in [
            "Query.a",
            "Query.b",
            "Query.c",
            "Query.d: `cost` (3) is larger than `limit` (2)",
            "unknown argument \"burst\"",
            "Query.f",
            "Thing.g: not supported on interface fields",
        ] {
            assert!(
                joined.contains(expected),
                "missing {expected:?} in:\n{joined}"
            );
        }
    }

    #[test]
    fn a_schema_without_the_directive_yields_an_empty_set() {
        assert!(rules_from("type Query { a: Int }").unwrap().is_empty());
    }
}
