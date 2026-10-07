import type { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { env } from "../config/env";

// Live delivery for the conversations (see models/message.model.ts).
//
// A portal's server can't hand the browser the API's access token, so a signed-in person asks
// the API for a short-lived ticket (GET /messages/realtime-ticket) and the browser connects
// with that. The ticket says who they are and which conversations they may hear: one client's
// for a client login, the clients they can see for staff — or all of them, for an admin.

type RealtimeTicket = {
  type: "message-realtime";
  userId: string;
  // The clients whose conversations this person may hear.
  clients: string[] | "all";
};

let io: Server | null = null;

const clientRoom = (clientId: string) => `messages:client:${clientId}`;
const ALL_CLIENTS_ROOM = "messages:all";
const userRoom = (userId: string) => `user:${userId}`;

export const createMessageRealtimeTicket = (userId: string, clients: RealtimeTicket["clients"]) =>
  jwt.sign({ type: "message-realtime", userId, clients } satisfies RealtimeTicket, env.jwtSecret, { expiresIn: "15m" });

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
      if (payload.type !== "message-realtime" || !payload.userId) throw new Error("Invalid ticket");
      socket.data.messageTicket = payload;
      next();
    } catch {
      next(new Error("Unauthorized realtime connection"));
    }
  });

  io.on("connection", (socket) => {
    const ticket = socket.data.messageTicket as RealtimeTicket;
    socket.join(userRoom(ticket.userId));
    if (ticket.clients === "all") socket.join(ALL_CLIENTS_ROOM);
    else for (const clientId of ticket.clients ?? []) socket.join(clientRoom(clientId));
  });

  return io;
};

// A new message in a client's conversation — to everyone listening to it.
export const emitNewMessage = (clientId: string, message: unknown) => {
  io?.to(ALL_CLIENTS_ROOM).to(clientRoom(clientId)).emit("messages:new", message);
};

// Something for particular people, wherever they are connected — e.g. "you have a new notification".
export const emitToUsers = (userIds: string[], event: string, payload: unknown) => {
  if (!io || userIds.length === 0) return;
  io.to(userIds.map(userRoom)).emit(event, payload);
};
