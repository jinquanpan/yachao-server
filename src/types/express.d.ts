declare global {
  namespace Express {
    interface Request {
      requestId: string;
      rawBody?: Buffer;
      user?: {
        id: string;
        session_id: string;
        token_hash: string;
        role: "user" | "super_admin";
      };
    }
  }
}

export {};
