import { redirect } from "next/navigation";
import { FINANCE_ROUTES } from "../../finance/_desk/routes";

export default function EventTradePage() {
  redirect(FINANCE_ROUTES.markets);
}
