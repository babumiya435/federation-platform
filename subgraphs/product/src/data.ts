import { encodeGlobalId } from "@federation-platform/global-id";

export interface ProductRecord {
  /** Global id, also the federation key. */
  id: string;
  localId: string;
  name: string;
  price: number;
  internalCost: number;
}

export interface ReviewRecord {
  /** Global id, also the federation key. */
  id: string;
  localId: string;
  productLocalId: string;
  rating: number;
  body: string;
  authorEmail: string;
}

export const productId = (localId: string) => encodeGlobalId("Product", localId);
export const reviewId = (localId: string) => encodeGlobalId("Review", localId);

type Seed<T> = Omit<T, "id">;

const SEED_PRODUCTS: Seed<ProductRecord>[] = [
  { localId: "trail-backpack", name: "Trail Backpack", price: 89.0, internalCost: 41.5 },
  { localId: "insulated-bottle", name: "Insulated Bottle", price: 24.5, internalCost: 9.2 },
  { localId: "camp-stove", name: "Camp Stove", price: 59.99, internalCost: 27.0 },
  { localId: "headlamp", name: "Headlamp", price: 34.0, internalCost: 12.75 },
  { localId: "merino-socks", name: "Merino Socks", price: 18.0, internalCost: 6.1 },
];

const SEED_REVIEWS: Seed<ReviewRecord>[] = [
  { localId: "trail-backpack-review-1", productLocalId: "trail-backpack", rating: 5, body: "Carried it for a week, no complaints.", authorEmail: "ana@example.com" },
  { localId: "trail-backpack-review-2", productLocalId: "trail-backpack", rating: 3, body: "Zips feel cheap.", authorEmail: "ben@example.com" },
  { localId: "insulated-bottle-review-1", productLocalId: "insulated-bottle", rating: 4, body: "Keeps coffee hot all morning.", authorEmail: "cleo@example.com" },
];

/** In-memory store. Persistence is out of scope for this exercise. */
export class CatalogStore {
  private readonly products: ProductRecord[];
  private readonly reviews: ReviewRecord[];

  constructor() {
    this.products = SEED_PRODUCTS.map((product) => ({ ...product, id: productId(product.localId) }));
    this.reviews = SEED_REVIEWS.map((review) => ({ ...review, id: reviewId(review.localId) }));
  }

  allProducts(): ProductRecord[] {
    return this.products;
  }

  product(localId: string): ProductRecord | undefined {
    return this.products.find((product) => product.localId === localId);
  }

  review(localId: string): ReviewRecord | undefined {
    return this.reviews.find((review) => review.localId === localId);
  }

  reviewsFor(productLocalId: string): ReviewRecord[] {
    return this.reviews.filter((review) => review.productLocalId === productLocalId);
  }

  addReview(input: Omit<ReviewRecord, "id" | "localId">): ReviewRecord {
    const localId = `${input.productLocalId}-review-${this.reviewsFor(input.productLocalId).length + 1}`;
    const record: ReviewRecord = { ...input, localId, id: reviewId(localId) };
    this.reviews.push(record);
    return record;
  }
}
