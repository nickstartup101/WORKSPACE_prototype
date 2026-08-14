# Security Specification - LA DOLCE WORKSPACE

## Data Invariants
1. Only authenticated users can read or write data.
2. Transactions must have a valid type (income/expense) and non-negative amount.
3. Supplier prices must reference a valid productId and contain a LAK price.
4. Recipes must have at least one ingredient.
5. App Config can only be modified by authenticated users.
6. User profiles (if any) are isolated.

## The Dirty Dozen (Test Payloads)
1. **Unauthenticated Read**: Try to read `/products` without login.
2. **Identity Spoofing**: Create a transaction with `userId` of another user.
3. **Negative Price**: Update a `supplierPrice` with a negative amount.
4. **Invalid Transaction Type**: Create a transaction with type `donation`.
5. **shadow field injection**: Add `isVerified: true` to a product.
6. **Immortal Field Violation**: Try to change `createdAt` on an existing product.
7. **Resource Poisoning**: Create a supplier with a 1MB name.
8. **Orphaned Price**: Create a price for a non-existent productId.
9. **Terminal State Bypass**: (N/A for current entities, but good for future).
10. **PII Leak**: Read `/users` as a different user.
11. **Admin Escalation**: Try to write to `/settings/appConfig` as a non-verified user (if verification enforced).
12. **Mass Query Scraping**: Try a list query without a proper filter (if enforced).

## Test Runner Logic
Verified with `firestore.rules.test.ts`.
