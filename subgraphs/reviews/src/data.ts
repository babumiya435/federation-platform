import { encodeGlobalId } from "@federation-platform/global-id";

export interface ReviewRecord {
  /** Global id, also the federation key. */
  id: string;
  localId: string;
  /** The reviewed product's local id; the product itself lives in the product subgraph. */
  productLocalId: string;
  rating: number;
  body: string;
  authorEmail: string;
}

export const reviewId = (localId: string) => encodeGlobalId("Review", localId);
export const productId = (localId: string) => encodeGlobalId("Product", localId);

const SEED_REVIEWS: Omit<ReviewRecord, "id">[] = [
  { localId: "trail-backpack-review-1", productLocalId: "trail-backpack", rating: 5, body: "Carried it for a week, no complaints.", authorEmail: "ana@example.com" },
  { localId: "trail-backpack-review-2", productLocalId: "trail-backpack", rating: 3, body: "Zips feel cheap.", authorEmail: "ben@example.com" },
  { localId: "insulated-bottle-review-1", productLocalId: "insulated-bottle", rating: 4, body: "Keeps coffee hot all morning.", authorEmail: "cleo@example.com" },
];

/** In-memory store. Persistence is out of scope for this exercise. */
export class ReviewStore {
  private readonly reviews: ReviewRecord[] = SEED_REVIEWS.map((review) => ({ ...review, id: reviewId(review.localId) }));

  find(localId: string): ReviewRecord | undefined {
    return this.reviews.find((review) => review.localId === localId);
  }

  forProduct(productLocalId: string): ReviewRecord[] {
    return this.reviews.filter((review) => review.productLocalId === productLocalId);
  }

  add(input: Omit<ReviewRecord, "id" | "localId">): ReviewRecord {
    const localId = `${input.productLocalId}-review-${this.forProduct(input.productLocalId).length + 1}`;
    const record: ReviewRecord = { ...input, localId, id: reviewId(localId) };
    this.reviews.push(record);
    return record;
  }
}
