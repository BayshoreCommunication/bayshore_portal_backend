import type { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { env } from "../config/env";

type RealtimeTicket = {
  type: "message-realtime";
  scope: "staff" | "conversation";
  conversationId?: string;
};

let io: Server | null = null;

export const createMessageRealtimeTicket = (
  scope: RealtimeTicket["scope"],
  conversationId?: string
) =>
  jwt.sign(
    { type: "message-realtime", scope, conversationId } satisfies RealtimeTicket,
    env.jwtSecret,
    { expiresIn: "15m" }
  );

export const initializeMessagesRealtime = (server: HttpServer) => {
  io = new Server(server, {
    path: "/socket.io",
    cors: {
      origin: env.isProduction ? env.clientUrls : true,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const ticket = String(socket.handshake.auth?.ticket || "");
      const payload = jwt.verify(ticket, env.jwtSecret) as RealtimeTicket;
      if (payload.type !== "message-realtime") throw new Error("Invalid ticket");
      socket.data.messageTicket = payload;
      next();
    } catch {
      next(new Error("Unauthorized realtime connection"));
    }
  });

  io.on("connection", (socket) => {
    const ticket = socket.data.messageTicket as RealtimeTicket;
    if (ticket.scope === "staff") socket.join("messages:staff");
    if (ticket.scope === "conversation" && ticket.conversationId) {
      socket.join(`messages:conversation:${ticket.conversationId}`);
    }
  });

  return io;
};

export const emitConversationUpdated = (conversationId: string, payload: unknown) => {
  io?.to("messages:staff").emit("messages:conversation-updated", payload);
  io?.to(`messages:conversation:${conversationId}`).emit("messages:conversation-updated", payload);
};

export const emitNewMessage = (conversationId: string, payload: unknown) => {
  io?.to("messages:staff").emit("messages:new", payload);
  io?.to(`messages:conversation:${conversationId}`).emit("messages:new", payload);
};
