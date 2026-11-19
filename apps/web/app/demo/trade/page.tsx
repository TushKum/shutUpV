import { redirect } from "next/navigation";
import { FINANCE_ROUTES } from "../finance/_desk/routes";

export default function TradePage() {
  redirect(FINANCE_ROUTES.markets);
}
