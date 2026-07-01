import express from "express";
import request from "supertest";
import { projectsRouter } from "../projects";
import { supabase } from "../../lib/supabase";

// Setup a minimal express app to test the router
const app = express();
app.use(express.json());

// Mock the auth middleware to simulate authenticated user
jest.mock("../../middleware/clerkAuth", () => ({
  clerkAuth: (req: any, res: any, next: any) => {
    // We allow setting custom auth mock in the request via a header for testing
    const role = req.headers["x-test-role"] || "sub_admin";
    req.auth = {
      userId: "user_test_uuid_which_is_36_chars_1",
      orgId: req.headers["x-test-org-id"] !== 'undefined' ? (req.headers["x-test-org-id"] || "org_test") : undefined,
      role
    };
    next();
  }
}));

// Mock requireRole middleware to let it pass if role matches
jest.mock("../../middleware/requireRole", () => ({
  requireRole: (requiredRole: string) => (req: any, res: any, next: any) => {
    // Simple mock logic: if we hit this, just allow it for testing if role is sub_admin
    if (req.auth.role === "sub_admin") {
      next();
    } else {
      res.status(403).json({ error: "Access denied" });
    }
  }
}));

// Mock Supabase client completely
jest.mock("../../lib/supabase", () => {
  const mSupabase = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockReturnThis(),
  };
  return { supabase: mSupabase };
});

app.use("/api/projects", projectsRouter);

describe("Projects API - Edge Cases and Validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/projects", () => {
    it("should return 400 if orgId is missing", async () => {
      const response = await request(app)
        .post("/api/projects")
        .set("x-test-org-id", "undefined") // Simulate missing orgId
        .send({
          name: "Test Project",
          site_url: "https://example.com"
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error", "Organization ID is required");
    });

    it("should handle Postgres unique constraint violation (code 23505) gracefully", async () => {
      // Mock Supabase to return the 23505 error on insert
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === "projects") {
          return {
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: { code: "23505", message: "duplicate key value violates unique constraint" }
                })
              })
            })
          };
        }
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({data: {id: "user_test_uuid_which_is_36_chars_1"}}) };
      });

      const response = await request(app)
        .post("/api/projects")
        .send({
          name: "Duplicate Project",
          site_url: "https://example.com"
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error", 'A project with the name "Duplicate Project" already exists.');
    });

    it("should return 500 for generic database failures on project creation", async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === "projects") {
          return {
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: { code: "50000", message: "Database connection dropped" }
                })
              })
            })
          };
        }
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({data: {id: "user_test_uuid_which_is_36_chars_1"}}) };
      });

      const response = await request(app)
        .post("/api/projects")
        .send({
          name: "New Project",
          site_url: "https://example.com"
        });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty("error", "Database connection dropped");
    });
  });
});
