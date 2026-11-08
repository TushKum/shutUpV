import type { Metadata } from "next";
import { currentViewer } from "@/lib/auth/viewer";
import { supabaseServer } from "@/lib/supabase/server";
import { dateTime } from "@/lib/format";
import { Badge, Notice, Panel, Table, Td, inputClass, type Tone } from "@/components/ui/ui";
import { ActionButton, ActionForm } from "@/components/ui/action";
import { addOrganiser, removeAccess, resetPassword } from "./actions";

export const metadata: Metadata = { title: "Access" };

interface Staff {
  user_id: string;
  role: "ORGANISER" | "FAIRNESS" | "DISPLAY";
  name: string;
  email: string;
  created_at: string;
  me: boolean;
}
const TONE: Record<Staff["role"], Tone> = { ORGANISER: "green", FAIRNESS: "violet", DISPLAY: "slate" };
const ROLE: Record<Staff["role"], string> = { ORGANISER: "Organiser", FAIRNESS: "Fairness officer", DISPLAY: "Projector" };

// Access (organisers only): who can sign in to the control panel and the projector, and giving another person
// organiser access. Every change is in the audit log.
export default async function AccessPage() {
  const viewer = await currentViewer();
  if (viewer!.role !== "ORGANISER") {
    return <Notice>Only organisers can see and change who has access.</Notice>;
  }
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("staff_list");
  const staff = (data ?? []) as Staff[];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-6 lg:col-span-2">
        <Panel title={`Staff with access (${staff.length})`}>
          {error ? (
            <Notice tone="amber">
              {/staff_list/.test(error.message)
                ? "The database does not have this page's functions yet: load the latest update (npx supabase db push on the organiser laptop), then reload."
                : `Could not read the staff list: ${error.message}`}
            </Notice>
          ) : null}
          <Table head={["Name", "Email", "Role", "Since", ""]} empty="No staff.">
            {staff.map((s) => (
              <tr key={s.user_id}>
                <Td>
                  {s.name}
                  {s.me ? <span className="ml-1 text-xs text-slate-500">(you)</span> : null}
                </Td>
                <Td mono>{s.email}</Td>
                <Td>
                  <Badge tone={TONE[s.role]}>{ROLE[s.role]}</Badge>
                </Td>
                <Td>{dateTime(s.created_at)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    <ActionButton action={resetPassword.bind(null, s.user_id, s.email)} confirm={`Click again: new password for ${s.name}`}>
                      Reset password
                    </ActionButton>
                    {s.me ? null : (
                      <ActionButton action={removeAccess.bind(null, s.user_id)} confirm={`Click again: remove ${s.name}'s access`}>
                        Remove access
                      </ActionButton>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>
      <div className="min-w-0 space-y-6">
        <Panel title="Give organiser access">
          <p className="text-sm text-slate-600">
            The person gets their own login with the full control panel, including Event timing and this page. A password is made for them and
            shown once below: give it to them in person.
          </p>
          <ActionForm action={addOrganiser} submit="Give access" confirm="Click again: make {name} an organiser" resetOnSuccess className="mt-3 space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Name</span>
              <input name="name" required maxLength={80} className={inputClass} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Email (their sign-in; no mail is sent)</span>
              <input name="email" type="email" required className={inputClass} />
            </label>
          </ActionForm>
        </Panel>
        <Notice>
          Nobody can remove their own access, and the last organiser always stays. Removing access deletes that login. Fairness officers and
          projector logins are created with the event (the staff list of the seed command).
        </Notice>
      </div>
    </div>
  );
}
