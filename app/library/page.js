"use client";
import { useEffect, useState } from "react";
import { upload } from "@vercel/blob/client";
import Nav from "../../components/Nav";
import { useCurrentUser } from "../../lib/use-current-user";

export default function LibraryPage() {
  const user = useCurrentUser();
  const [movies, setMovies] = useState(undefined);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ percentage: 0, loaded: 0, total: 0 });
  const [slowWarning, setSlowWarning] = useState(false);
  const [error, setError] = useState("");

  function loadMovies() {
    fetch("/api/movies")
      .then((r) => r.json())
      .then((d) => setMovies(d.movies || []));
  }

  useEffect(() => {
    if (user) loadMovies();
  }, [user]);

  function formatMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1);
  }

  async function handleUpload(e) {
    e.preventDefault();
    setError("");
    if (!title.trim()) return setError("Give the movie a title");
    if (!file) return setError("Choose a video file");

    setBusy(true);
    setProgress({ percentage: 0, loaded: 0, total: file.size });
    setSlowWarning(false);

    // If progress hasn't moved in a while, let the person know rather than
    // leaving them staring at a stuck bar with no explanation.
    const lastLoadedRef = { current: 0 };
    const stallCheck = setInterval(() => {
      setProgress((p) => {
        setSlowWarning(p.loaded === lastLoadedRef.current && p.loaded < p.total);
        lastLoadedRef.current = p.loaded;
        return p;
      });
    }, 15000);

    try {
      // Uploads straight from the browser to Vercel Blob storage — this
      // route never sends the video bytes through a serverless function,
      // so large files (well beyond the old 4.5MB function limit) work fine.
      // Wrapped with a hard timeout so a stuck/hanging upload shows a clear
      // error instead of leaving the button stuck on "Uploading... 100%"
      // forever with no way to tell what happened.
      const uploadPromise = upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        onUploadProgress: (p) => setProgress(p),
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Upload timed out after 5 minutes — try again, or try a smaller file")), 5 * 60 * 1000)
      );
      const blob = await Promise.race([uploadPromise, timeoutPromise]);

      const res = await fetch("/api/movies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, videoUrl: blob.url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload finished, but saving it to your library failed");

      setTitle("");
      setFile(null);
      setShowForm(false);
      loadMovies();
    } catch (err) {
      // Log the full error object (not just .message) — Vercel Blob's
      // rejection reason is often only visible there, and matching it
      // against the server logs (console.error in /api/upload) is the
      // fastest way to diagnose an upload that fails without a clear reason.
      console.error("Upload failed:", err);
      setError(err.message || "Something went wrong — check the browser console for details");
    } finally {
      clearInterval(stallCheck);
      setBusy(false);
      setSlowWarning(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Remove this movie from your library?")) return;
    await fetch(`/api/movies/${id}`, { method: "DELETE" });
    loadMovies();
  }

  if (!user) return null;

  return (
    <main>
      <Nav username={user.username} />
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-start justify-between mb-8">
          <div>
            <p className="text-xs uppercase tracking-wide text-accent mb-1">Your collection</p>
            <h1 className="text-2xl font-bold mb-1">Movie library</h1>
            <p className="text-sm text-neutral-500">
              Everything you've uploaded — ready to stream privately or share in a watch room.
            </p>
          </div>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="px-5 py-2.5 bg-accent rounded-lg font-medium hover:opacity-90 whitespace-nowrap"
          >
            + Upload movie
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={handleUpload}
            className="mb-8 p-6 rounded-xl bg-neutral-900 border border-neutral-800 space-y-4"
          >
            <input
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2"
              placeholder="Movie title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              type="file"
              accept="video/*,.mp4,.webm,.ogg,.ogv,.mov,.mkv,.m4v"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-neutral-400"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            {busy && (
              <div>
                <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{ width: `${progress.percentage}%` }}
                  />
                </div>
                <p className="text-xs text-neutral-500 mt-1">
                  {formatMB(progress.loaded)} MB / {formatMB(progress.total)} MB (
                  {Math.round(progress.percentage)}%)
                </p>
                {slowWarning && (
                  <p className="text-xs text-amber-400 mt-1">
                    This hasn't moved in a while — check your connection. Large files can still
                    take a few minutes.
                  </p>
                )}
              </div>
            )}
            <button
              disabled={busy}
              className="bg-accent px-5 py-2 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
            >
              {busy ? `Uploading... ${Math.round(progress.percentage)}%` : "Add to library"}
            </button>
          </form>
        )}

        {movies === undefined && null}

        {movies && movies.length === 0 && (
          <div className="text-center py-20 border border-dashed border-neutral-800 rounded-xl">
            <p className="text-lg font-semibold mb-2">Your library is empty</p>
            <p className="text-sm text-neutral-500 mb-6">
              Upload a legally owned movie file to start your first private watch party.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="px-5 py-2.5 bg-accent rounded-lg font-medium hover:opacity-90"
            >
              + Upload movie
            </button>
          </div>
        )}

        {movies && movies.length > 0 && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {movies.map((m) => (
              <div
                key={m.id}
                className="p-5 rounded-xl bg-neutral-900 border border-neutral-800 flex flex-col gap-3"
              >
                <div className="aspect-video rounded-lg bg-neutral-950 flex items-center justify-center text-neutral-700 text-3xl">
                  🎬
                </div>
                <p className="font-medium truncate">{m.title}</p>
                <button
                  onClick={() => handleDelete(m.id)}
                  className="text-xs text-neutral-500 hover:text-red-400 text-left"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
