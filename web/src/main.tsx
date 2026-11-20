import { render } from "preact";
import { App } from "./app.tsx";
import { connect } from "./supabase.ts";

const api = await connect();
render(<App api={api} />, document.getElementById("app")!);
