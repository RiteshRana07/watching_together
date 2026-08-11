import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const { getRoomByCode, updateRoomCurrentVideo } = require("../../../../../lib/db");
const { verifyToken } = require("../../../../../lib/auth");
const { resolveVideoInfo } = require("../../../../../lib/youtube");
const pusher = require("../../../../../lib/pusher");

export async function PATCH(req, { params }) {
  const token = cookies().get("wt_session")?.value;
  const payload = token && verifyToken(token);
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const code = params.code.toUpperCase();
  const room = await getRoomByCode(code);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.host_id !== payload.userId) {
    return NextResponse.json({ error: "Only the host can change what's playing" }, { status: 403 });
  }

  const { videoUrl } = await req.json();
  if (!videoUrl) return NextResponse.json({ error: "Missing video URL" }, { status: 400 });

  const info = await resolveVideoInfo(videoUrl);
  const updated = await updateRoomCurrentVideo(code, payload.userId, info);

  if (!updated) {
    return NextResponse.json({ error: "Couldn't update the room" }, { status: 500 });
  }

  // Push the new "now playing" video to everyone currently in the room, live.
  // The room's original video_url/video_title are untouched, so its
  // identity/thumbnail stays fixed even as playback moves on.
  await pusher.trigger(`presence-room-${code}`, "room:video-changed", {
    videoUrl: updated.current_video_url,
    videoTitle: updated.current_video_title,
    videoSource: updated.current_video_source,
  });

  return NextResponse.json({ room: updated });
}
