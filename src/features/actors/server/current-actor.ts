import { cookies, headers } from "next/headers";
import { getActorRepository } from "@/db/client";
import { ACTOR_COOKIE_NAME, ACTOR_HEADER_NAME, createActorResolver } from "./actor-resolver";

export async function getCurrentActor() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return createActorResolver(getActorRepository())({
    cookieActorId: cookieStore.get(ACTOR_COOKIE_NAME)?.value,
    headerActorId: headerStore.get(ACTOR_HEADER_NAME),
  });
}
