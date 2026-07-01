import express from "express";
import request from "supertest";
import { tasksRouter } from "../tasks";
import { supabase } from "../../lib/supabase";

const app = express();
app.use(express.json());

// Mock auth middleware
jest.mock("../../middleware/clerkAuth", () => ({
  clerkAuth: (req: any, res: any, next: any) => {
    req.auth = {
      userId: "user_test_uuid_which_is_36_chars_1",
      orgId: "org_test",
      role: req.headers["x-test-role"] || "developer"
    };
    next();
  }
}));

jest.mock("../../middleware/requireRole", () => ({
  requireRole: (requiredRole: string) => (req: any, res: any, next: any) => {
      next();
  }
}));

// Mock Supabase
jest.mock("../../lib/supabase", () => {
  return {
    supabase: {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
    }
  };
});

app.use("/api/tasks", tasksRouter);

describe("Tasks API - Edge Cases and Validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/tasks", () => {
    it("should prevent a developer from creating a non-feedback task", async () => {
      const response = await request(app)
        .post("/api/tasks")
        .set("x-test-role", "developer")
        .send({
          finding_id: "some_id",
          project_id: "proj_1",
          title: "Regular Bug Report", // Doesn't start with [Feedback]
          description: "Something is broken",
          severity: "high"
        });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty("error", "Developers can only create feedback tasks.");
    });

    it("should allow a developer to create a [Feedback] task", async () => {
       // Mock the DB response to task fetch
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === "tasks") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [], // No existing tasks
              error: null
            }),
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { id: "task_1", title: "[Feedback] UI is bad", project_id: "proj_1" },
                  error: null
                })
              })
            })
          };
        }
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({data: {id: "user_test_uuid_which_is_36_chars_1"}}) };
      });

      const response = await request(app)
        .post("/api/tasks")
        .set("x-test-role", "developer")
        .send({
          project_id: "proj_1",
          title: "[Feedback] UI is bad",
          description: "Needs improvement",
          severity: "low"
        });

      expect(response.status).toBe(201);
    });
  });

  describe("GET /api/tasks/:id", () => {
    it("should validate UUID and return 404 for malformed IDs", async () => {
      const response = await request(app).get("/api/tasks/not-a-valid-uuid");
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("error", "Task not found");

      // Ensure supabase wasn't called because it failed regex
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/tasks/bulk-delete", () => {
    it("should handle corrupted/empty payload gracefully", async () => {
      const response = await request(app)
        .post("/api/tasks/bulk-delete")
        .set("x-test-role", "qa_engineer")
        .send({}); // Missing 'ids' array

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error", "ids array is required");
    });

    it("should manage transaction failure correctly if DB throws", async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === "users") {
           return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({data: {id: "u1"}}) };
        }
        if (table === "tasks") {
           const mockDelete = {
               delete: jest.fn().mockReturnThis(),
               in: jest.fn().mockResolvedValue({
                 data: null,
                 error: { message: "Timeout" }
               })
           };
           // for the first fetch, mock ok
           const mockSelect = {
               select: jest.fn().mockReturnThis(),
               in: jest.fn().mockResolvedValue({
                 data: [], error: null
               })
           };

           // We need a complex mock to return diff things based on whether delete() or select() was called
           return {
               select: jest.fn().mockReturnValue(mockSelect),
               delete: jest.fn().mockReturnValue(mockDelete)
           };
        }
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({data: {id: "u1"}}) };
      });

      const response = await request(app)
        .post("/api/tasks/bulk-delete")
        .set("x-test-role", "qa_engineer")
        .send({ ids: ["123e4567-e89b-12d3-a456-426614174000"] });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty("error", "Timeout");
    });
  });
});
