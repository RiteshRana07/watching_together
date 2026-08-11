import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { handleUpload } from "@vercel/blob/client";
const { verifyToken } = require("../../../lib/auth");

export const runtime = "nodejs";

// This route no longer receives the video file itself. Routing a whole
// video through a Vercel serverless function hits Vercel's ~4.5MB request
// body limit ("Request Entity Too Large" — which is what showed up as
// "Unexpected token 'R'..." since that error page isn't JSON). Instead, the
// browser uploads directly to Vercel Blob; this route only ever issues a
// short-lived, scoped upload token and gets a small "upload finished"
// callback — the large file bytes never pass through this function.
export async function POST(request) {
  const body = await request.json();

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Auth check belongs here, not at the top of the route — this
        // callback only runs for the initial "give me an upload token"
        // request from the signed-in user's browser. The *separate*
        // "upload completed" callback Vercel Blob sends afterwards is a
        // server-to-server request with no browser cookie attached; gating
        // the whole route on a cookie caused that callback to get rejected
        // every time, which is why large uploads looped instead of finishing.
        const token = cookies().get("wt_session")?.value;
        if (!token || !verifyToken(token)) {
          throw new Error("Not signed in");
        }

        // Not restricting allowedContentTypes here on purpose: browsers
        // (especially for screen-recorded videos on phones) often report a
        // MIME type that doesn't exactly match "video/mp4" even for a real
        // .mp4 file — e.g. "video/quicktime", or occasionally an empty
        // string. Vercel Blob rejects the upload outright with a 400 if the
        // reported type isn't in the allowlist, which is what was causing
        // uploads to fail repeatedly. We check the file extension instead,
        // which is far more reliable for user-recorded video files.
        const allowedExtensions = [".mp4", ".webm", ".ogg", ".ogv", ".mov", ".mkv", ".m4v"];
        const hasAllowedExtension = allowedExtensions.some((ext) =>
          pathname.toLowerCase().endsWith(ext)
        );
        if (!hasAllowedExtension) {
          throw new Error("Unsupported file type — upload a video file (.mp4, .webm, .mov, etc).");
        }

        return {
          addRandomSuffix: true,
          maximumSizeInBytes: 2 * 1024 * 1024 * 1024, // 2GB
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Nothing to do here — the client gets the blob URL back directly
        // and saves it to the movie library itself. Logged so a failure in
        // this callback (which the browser never sees) still shows up in
        // Vercel's function logs instead of failing silently.
        console.log("Blob upload completed:", blob.url);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    // Logged server-side so the real failure reason is visible in Vercel's
    // Function Logs even when the browser only sees a generic message.
    console.error("Upload route error:", error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
