"use client";

import { useRef } from "react";
import type { ActorContext } from "../domain/actor";
import { selectActorAction } from "../server/actions";

export function ActorSwitcher({ actor }: { actor: ActorContext }) {
  const formRef = useRef<HTMLFormElement>(null);
  return <form ref={formRef} action={selectActorAction} className="actor-switcher">
    <label htmlFor="current-actor">현재 작업자</label>
    <div className="actor-switcher__control">
      <select
        id="current-actor"
        name="actorId"
        defaultValue={actor.userId}
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="user-fixed">나 · 사람</option>
        <option value="user-codex">Codex · AI</option>
      </select>
      <span className={`actor-badge actor-badge--${actor.actorType}`}>
        {actor.actorType === "ai" ? "AI" : "사람"}
      </span>
    </div>
  </form>;
}
