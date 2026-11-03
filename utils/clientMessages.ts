import type mongoose from "mongoose";
import { Client, type ClientMessage, type ClientMessageChannel, type IClient } from "../models/client.model";

// Whether a system message may go to a client, by the team's switches for them (client.messagesOff,
// set on the company portal's Notifications page). Everything goes unless switched off.

type Id = mongoose.Types.ObjectId | string;

export const isOff = (client: Pick<IClient, "messagesOff"> | null | undefined, message: ClientMessage, channel: ClientMessageChannel) =>
  Boolean(client?.messagesOff?.includes(`${message}.${channel}`));

// The same, looked up by the client's id.
export const clientAllows = async (clientId: Id, message: ClientMessage, channel: ClientMessageChannel) => {
  const client = await Client.findById(clientId).select("messagesOff").lean();
  return !isOff(client, message, channel);
};
