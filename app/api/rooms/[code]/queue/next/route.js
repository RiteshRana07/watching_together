import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const {
  getRoomByCode,
  popNextFromQueue,
  listQueue,
  updateRoomCurrentVideo,
} = require("../../../../../../lib/db");
const { verifyToken } = require("../../../../../../lib/auth");
const pusher = require("../../../../../../lib/pusher");

export async function POST(req, { params }) {
  const token = cookies().get("wt_session")?.value;
  const payload = token && verifyToken(token);
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const code = params.code.toUpperCase();
  const room = await getRoomByCode(code);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.host_id !== payload.userId) {
    return NextResponse.json({ error: "Only the host can advance the queue" }, { status: 403 });
  }

  const next = await popNextFromQueue(room.id);
  if (!next) {
    return NextResponse.json({ error: "The queue is empty" }, { status: 400 });
  }

  const updated = await updateRoomCurrentVideo(code, payload.userId, {
    videoUrl: next.video_url,
    videoTitle: next.video_title,
    videoSource: next.video_source,
  });

  const queue = await listQueue(room.id);

  await pusher.trigger(`presence-room-${code}`, "room:video-changed", {
    videoUrl: updated.current_video_url,
    videoTitle: updated.current_video_title,
    videoSource: updated.current_video_source,
  });
  await pusher.trigger(`presence-room-${code}`, "room:queue-changed", { queue });

  return NextResponse.json({ room: updated, queue });
}
