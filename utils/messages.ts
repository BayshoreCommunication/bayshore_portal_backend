import type mongoose from "mongoose";
import { Client } from "../models/client.model";
import type { IContent, IContentFile } from "../models/content.model";
import { Message, type IMessage, type IMessageMeeting, type MessageKind, type MessageSide } from "../models/message.model";
import { Notification, NOTIFICATION_BODY_MAX_LENGTH, NOTIFICATION_TITLE_MAX_LENGTH } from "../models/notification.model";
import { User, type IUser } from "../models/user.model";
import { emitNewMessage, emitToUsers } from "../realtime/messagesRealtime";

// Putting a message into a client's conversation: saving it, sending it live to whoever has
// the conversation open, and telling the other side through their notifications.

type Id = mongoose.Types.ObjectId;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// Which side of the conversation someone writes on.
export const sideOf = (user: Pick<IUser, "role">): MessageSide => (user.role === "client" ? "client" : "team");

// ── Notifications ────────────────────────────────────────────────────────────

// The other side of a client's conversation: its logins when the team writes, the staff on
// it — account manager, team, whoever added it — when the client does. Never the writer.
const otherSideOf = async (clientId: Id, side: MessageSide, except: Id) => {
  const client = await Client.findById(clientId).select("companyName accountManager team createdBy").lean();
  const company = client?.companyName ?? "A client";
  if (side === "team") {
    const recipients: Id[] = await User.find({ role: "client", client: clientId, status: "active", _id: { $ne: except } }).distinct("_id");
    return { recipients, company };
  }
  const ids = [client?.accountManager, ...(client?.team ?? []), client?.createdBy].filter((id): id is Id => Boolean(id));
  const recipients: Id[] = await User.find({ _id: { $in: ids, $ne: except }, status: "active", role: { $ne: "client" } }).distinct("_id");
  return { recipients, company };
};

const whenOf = (meeting: IMessageMeeting) =>
  meeting.startsAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

// Tells the other side. Messages nobody has read yet are one notification, not one each: a
// second message before the first is read updates it ("3 new messages") instead of adding to
// the pile. A notification is a courtesy — it never fails the message it reports.
const notifyOtherSide = async (message: IMessage, actor: IUser) => {
  try {
    const { recipients, company } = await otherSideOf(message.client, message.side, actor._id);
    if (recipients.length === 0) return;

    const from = message.side === "team" ? "BayShore" : company;
    const body =
      message.kind === "meeting" && message.meeting
        ? `${message.meeting.title} — ${whenOf(message.meeting)}`
        : message.text?.trim()
          ? `“${message.text.trim()}”`
          : `${message.attachments.length} ${message.attachments.length === 1 ? "file" : "files"} attached`;
    // The piece's own page when the message is about one; otherwise the conversation —
    // which staff open by client.
    const link = message.content ? `/content/${message.content}` : message.side === "client" ? `/messages?client=${message.client}` : "/messages";

    await Promise.all(
      recipients.map(async (recipient) => {
        const unread = await Notification.findOne({ recipient, type: "message", client: message.client, readAt: null });
        const count = (unread?.pieces ?? 0) + 1;
        const title =
          message.kind === "meeting"
            ? `${from} scheduled a meeting`
            : count === 1
              ? `${from} sent ${message.side === "team" ? "you " : ""}a message`
              : `${from} sent ${message.side === "team" ? "you " : ""}${count} messages`;
        const fields = {
          title: clip(title, NOTIFICATION_TITLE_MAX_LENGTH),
          body: clip(body, NOTIFICATION_BODY_MAX_LENGTH),
          link,
          actor: actor._id,
          actorName: actor.fullName,
          content: message.content,
          pieces: count,
        };
        if (unread) await Notification.updateOne({ _id: unread._id }, { $set: fields });
        else await Notification.create({ recipient, type: "message", client: message.client, ...fields });
      })
    );
    // Their bell can update at once instead of at its next poll.
    emitToUsers(recipients.map(String), "notifications:new", { type: "message", client: String(message.client) });
  } catch (error) {
    console.error("Message notification failed:", error);
  }
};

// ── Posting ──────────────────────────────────────────────────────────────────

// Saves a message someone wrote (or a meeting the team added), sends it live, and notifies
// the other side.
export const postMessage = async (
  actor: IUser,
  input: {
    client: Id;
    kind?: Extract<MessageKind, "text" | "meeting">;
    text?: string;
    attachments?: IContentFile[];
    content?: Pick<IContent, "_id" | "title">;
    meeting?: IMessageMeeting;
  }
) => {
  const message = await Message.create({
    client: input.client,
    kind: input.kind ?? "text",
    side: sideOf(actor),
    sender: actor._id,
    senderName: actor.fullName,
    text: input.text ?? "",
    attachments: input.attachments ?? [],
    content: input.content?._id,
    contentTitle: input.content?.title,
    meeting: input.meeting,
  });
  emitNewMessage(String(message.client), message.toJSON());
  await notifyOtherSide(message, actor);
  return message;
};

// The automatic messages: something happened on a piece, and the conversation should show
// it where it happened in time. Whoever did it is told about by the content notifications
// already, so these add no notification of their own — and, like those, they never fail
// the action they report.
const announce = async (
  content: IContent,
  actor: IUser,
  fields: { kind: Extract<MessageKind, "revision_requested" | "revision_submitted">; text?: string; attachments?: IContentFile[]; revision?: number }
) => {
  try {
    const message = await Message.create({
      client: content.client,
      kind: fields.kind,
      side: sideOf(actor),
      sender: actor._id,
      senderName: actor.fullName,
      text: fields.text ?? "",
      attachments: fields.attachments ?? [],
      content: content._id,
      contentTitle: content.title,
      revision: fields.revision,
    });
    emitNewMessage(String(message.client), message.toJSON());
  } catch (error) {
    console.error("Automatic message failed:", error);
  }
};

// The client asked for changes to a piece (or added to what they asked).
export const announceRevisionRequested = (content: IContent, actor: IUser, text: string | undefined, attachments: IContentFile[], revision: number) =>
  announce(content, actor, { kind: "revision_requested", text, attachments, revision });

// The team sent the revised piece back for approval, with their note if they left one.
export const announceRevisionSubmitted = (content: IContent, actor: IUser, note: string | undefined, revision: number | undefined) =>
  announce(content, actor, { kind: "revision_submitted", text: note, revision });
