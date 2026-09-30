import type { UserRole } from "@/auth";

/** Sessions used when mocking `@/auth`. Ids are not read by the actions we call. */
export const STAFF_SESSION = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "staff@catalogue.test",
    name: "Sam Sales",
    role: "staff" as UserRole,
  },
  expires: "2099-01-01T00:00:00.000Z",
};

export const ADMIN_SESSION = {
  user: {
    id: "00000000-0000-4000-8000-000000000002",
    email: "admin@catalogue.test",
    name: "Priya Admin",
    role: "admin" as UserRole,
  },
  expires: "2099-01-01T00:00:00.000Z",
};
