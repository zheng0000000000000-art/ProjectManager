"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getActorRepository } from "@/db/client";
import { ACTOR_COOKIE_NAME, createActorResolver } from "./actor-resolver";

export async function selectActorAction(formData: FormData) {
  const actorId = String(formData.get("actorId") ?? "");
  const actor = await createActorResolver(getActorRepository())({ headerActorId: actorId });
  const cookieStore = await cookies();
  cookieStore.set(ACTOR_COOKIE_NAME, actor.userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  revalidatePath("/task-pool");
  revalidatePath("/my-work");
}
