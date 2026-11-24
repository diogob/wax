// Building blocks shared by the app and the mock (web/mock.html).
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { type Failure, retryable } from "./call.ts";
import { route } from "./route.ts";

function CopyBox({ text, hint }: { text: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <>
      <div class="copybox">
        <pre>{text}</pre>
        <button type="button" onClick={copy}>{copied ? "Copied ✓" : "Copy command"}</button>
      </div>
      {hint && <p class="hint">{hint}</p>}
    </>
  );
}

type Chosen = { name: string; text: string };

// The command writes its output to a file; the user drops or picks that file here. `extra`
// renders more buttons next to submit, and can fill in a file (the mock's example files).
function FileBox(
  { file, submit, busy, onSubmit, extra }: {
    file: string;
    submit: string;
    busy?: boolean;
    onSubmit: (text: string) => string | void;
    extra?: (choose: (chosen: Chosen) => void) => ComponentChildren;
  },
) {
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    setError("");
    setChosen({ name: picked.name, text: await picked.text() });
  };
  const send = () => {
    if (!chosen?.text.includes("-----BEGIN PGP")) {
      return setError(`${chosen?.name} doesn't look like gpg output.`);
    }
    setError(onSubmit(chosen.text) ?? "");
  };
  return (
    <div class="filebox">
      <label
        class={dragging ? "drop dragging" : "drop"}
        onDragOver={(event) => (event.preventDefault(), setDragging(true))}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          choose(event.dataTransfer?.files[0]);
        }}
      >
        {chosen
          ? (
            <span>
              Selected <code>{chosen.name}</code>
            </span>
          )
          : (
            <span>
              Drop <code>{file}</code> here, or click to choose it
            </span>
          )}
        <input
          type="file"
          accept=".asc,.rev,text/plain"
          onChange={(event) => choose(event.currentTarget.files?.[0])}
        />
      </label>
      {error && <p class="error">{error}</p>}
      <div class="row">
        <button type="button" disabled={!chosen || busy} onClick={send}>
          {busy ? "Working…" : submit}
        </button>
        {extra?.((picked) => (setError(""), setChosen(picked)))}
      </div>
    </div>
  );
}

function Steps({ current, names }: { current: number; names: string[] }) {
  return (
    <ol class="steps">
      {names.map((name, index) => (
        <li class={index === current ? "current" : index < current ? "done" : ""}>{name}</li>
      ))}
    </ol>
  );
}

function ago(timestamp: string): string {
  const days = Math.floor((Date.now() - Date.parse(timestamp)) / 86_400_000);
  if (days < 1) return "today";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function short(fingerprint: string): string {
  return fingerprint.match(/.{4}/g)!.join(" ");
}

/** Clearsigns `statement` into `file`, with one -u per signing key (fingerprints). */
function clearsignCommand(statement: string, file: string, signers: string[] = []): string {
  const users = signers.map((fingerprint) => ` -u ${fingerprint}`).join("");
  return `printf '%s\\n' '${statement}' \\\n  | gpg${users} --clearsign --output ${file}`;
}

function Notice({ children }: { children: ComponentChildren }) {
  return <p class="notice">{children}</p>;
}

// A failed call: its message, and Retry when sending the same request again may work.
function ErrorNotice({ failure, onRetry }: { failure: Failure; onRetry: () => void }) {
  return (
    <div class="error">
      <p>{failure.message}</p>
      {retryable(failure) && (
        <button type="button" class="secondary" onClick={onRetry}>Retry</button>
      )}
    </div>
  );
}

// System → light → dark. The CSS uses light-dark(), which follows color-scheme on <html>.
const themes = ["system", "light", "dark"] as const;
type Theme = (typeof themes)[number];
// 16px line icons, drawn with currentColor.
const themeIcons: Record<Theme, string> = {
  system: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Z",
  light:
    "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1",
  dark: "M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z",
};

function applyTheme(theme: Theme) {
  document.documentElement.style.colorScheme = theme === "system" ? "light dark" : theme;
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("wax-theme") as Theme | null) ?? "system",
  );
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("wax-theme", theme);
  }, [theme]);
  const next = themes[(themes.indexOf(theme) + 1) % themes.length]!;
  return (
    <button
      type="button"
      class="theme"
      title={`Theme: ${theme}. Click for ${next}.`}
      aria-label={`Theme: ${theme}`}
      onClick={() => setTheme(next)}
    >
      <svg
        viewBox="0 0 16 16"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d={themeIcons[theme]} />
        {theme === "system" && <path fill="currentColor" d="M8 2a6 6 0 0 0 0 12Z" />}
      </svg>
    </button>
  );
}

// On narrow screens `links` fold behind a menu button (CSS decides when); `children` stay
// visible. `dot` marks the closed menu (unread messages).
function NavBar(
  { links, dot, children }: {
    links?: ComponentChildren;
    dot?: boolean;
    children?: ComponentChildren;
  },
) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [route.value]);
  return (
    <nav class={open ? "open" : ""}>
      <a href="#/" class="brand">Wax</a>
      {links}
      {children}
      <ThemeToggle />
      {links && (
        <button
          type="button"
          class="menu"
          aria-expanded={open}
          aria-controls="nav-links"
          aria-label="Menu"
          onClick={() => setOpen(!open)}
        >
          <svg
            viewBox="0 0 16 16"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d={open ? "M4 4l8 8M12 4l-8 8" : "M2.5 4.5h11M2.5 8h11M2.5 11.5h11"} />
          </svg>
          {!open && dot && <span class="dot" />}
        </button>
      )}
    </nav>
  );
}

// A wax seal stamped with the user's initial. The blob's outline is derived from the username, so
// each user's seal keeps the same shape. Colour comes from the CSS variable --wax (configurable
// per user later).
function sealOutline(username: string): string {
  const seed = [...username].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
  // A number in [0, 1) per point and purpose, from the seed; the same every render.
  const random = (index: number, salt: number) => {
    const mixed = Math.imul(seed ^ (index * 2654435761) ^ (salt * 40503), 2246822519);
    return ((mixed ^ (mixed >>> 15)) >>> 0) / 2 ** 32;
  };
  const count = 13;
  const points = Array.from({ length: count }, (_, index) => {
    // Lumps from just outside the ring (13.5) to the edge of the box (20).
    const radius = 13.5 + random(index, 1) ** 0.7 * 6.5;
    const angle = ((index + (random(index, 2) - 0.5) * 0.6) / count) * 2 * Math.PI;
    return { x: 20 + radius * Math.cos(angle), y: 20 + radius * Math.sin(angle) };
  });
  // Smooth closed curve: each point is a control point, midpoints are on the curve.
  const midpoint = (index: number) => {
    const from = points[index % count]!;
    const to = points[(index + 1) % count]!;
    return `${((from.x + to.x) / 2).toFixed(2)} ${((from.y + to.y) / 2).toFixed(2)}`;
  };
  const curves = points.map((point, index) =>
    `Q ${point.x.toFixed(2)} ${point.y.toFixed(2)} ${midpoint(index)}`
  );
  return `M ${midpoint(count - 1)} ${curves.join(" ")} Z`;
}

function Seal({ username }: { username: string }) {
  const initial = username[0]!.toUpperCase();
  return (
    <svg class="seal" viewBox="0 0 40 40" aria-hidden="true">
      <path class="seal-wax" d={sealOutline(username)} />
      <circle class="seal-ring" cx="20" cy="20" r="11.5" />
      <text class="seal-shine" x="20" y="20.8">{initial}</text>
      <text class="seal-letter" x="20" y="20">{initial}</text>
    </svg>
  );
}

function Handle({ username }: { username: string }) {
  return (
    <span class="handle">
      <Seal username={username} />
      <span>@{username}</span>
    </span>
  );
}

export {
  ago,
  clearsignCommand,
  CopyBox,
  ErrorNotice,
  FileBox,
  Handle,
  NavBar,
  Notice,
  Seal,
  short,
  Steps,
};
