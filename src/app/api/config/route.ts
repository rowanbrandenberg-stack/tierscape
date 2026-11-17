import { features } from "@/server/config";

export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(features());
}
