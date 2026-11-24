import { render } from "preact";
import { App } from "./app.tsx";
import { startSession } from "./session.ts";
import { connect } from "./supabase.ts";

const api = await connect();
startSession(api);
render(<App api={api} />, document.getElementById("app")!);
