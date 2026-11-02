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
  { localId: "p1", name: "Trail Backpack", price: 89.0, internalCost: 41.5 },
  { localId: "p2", name: "Insulated Bottle", price: 24.5, internalCost: 9.2 },
  { localId: "p3", name: "Camp Stove", price: 59.99, internalCost: 27.0 },
  { localId: "p4", name: "Headlamp", price: 34.0, internalCost: 12.75 },
  { localId: "p5", name: "Merino Socks", price: 18.0, internalCost: 6.1 },
];

const SEED_REVIEWS: Seed<ReviewRecord>[] = [
  { localId: "r1", productLocalId: "p1", rating: 5, body: "Carried it for a week, no complaints.", authorEmail: "ana@example.com" },
  { localId: "r2", productLocalId: "p1", rating: 3, body: "Zips feel cheap.", authorEmail: "ben@example.com" },
  { localId: "r3", productLocalId: "p2", rating: 4, body: "Keeps coffee hot all morning.", authorEmail: "cleo@example.com" },
];

/** In-memory store. Persistence is out of scope for this exercise. */
export class CatalogStore {
  private readonly products: ProductRecord[];
  private readonly reviews: ReviewRecord[];
  private nextReview: number;

  constructor() {
    this.products = SEED_PRODUCTS.map((p) => ({ ...p, id: productId(p.localId) }));
    this.reviews = SEED_REVIEWS.map((r) => ({ ...r, id: reviewId(r.localId) }));
    this.nextReview = this.reviews.length + 1;
  }

  allProducts(): ProductRecord[] {
    return this.products;
  }

  product(localId: string): ProductRecord | undefined {
    return this.products.find((p) => p.localId === localId);
  }

  review(localId: string): ReviewRecord | undefined {
    return this.reviews.find((r) => r.localId === localId);
  }

  reviewsFor(productLocalId: string): ReviewRecord[] {
    return this.reviews.filter((r) => r.productLocalId === productLocalId);
  }

  addReview(input: Omit<ReviewRecord, "id" | "localId">): ReviewRecord {
    const localId = `r${this.nextReview++}`;
    const record: ReviewRecord = { ...input, localId, id: reviewId(localId) };
    this.reviews.push(record);
    return record;
  }
}
