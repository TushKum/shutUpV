import type { Metadata } from "next";
import { NewsroomView } from "./newsroom-view";

export const metadata: Metadata = { title: "Newsroom" };

export default function TeamNewsroomPage() {
  return <NewsroomView />;
}
