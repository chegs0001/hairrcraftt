import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ClientCard from "../components/ClientCard";
import { ActionBar, BackLink, Button, Card, inputCls, Screen } from "../components/ui";
import { rpc } from "../lib/api";
import { supabase } from "../lib/supabase";
import type { Client, Visit } from "../lib/types";

export default function NewVisit() {
  const nav = useNavigate();
  const [phone, setPhone] = useState("");
  const ready = phone.length === 10;

  const found = useQuery({
    queryKey: ["client-by-phone", phone],
    enabled: ready,
    queryFn: async () =>
      (await supabase.from("clients").select("*").eq("phone", phone).maybeSingle())
        .data as Client | null,
  });
  const openVisit = useQuery({
    queryKey: ["open-visit", found.data?.id],
    enabled: !!found.data,
    queryFn: async () =>
      (
        await supabase
          .from("visits")
          .select("id")
          .eq("client_id", found.data!.id)
          .eq("status", "open")
          .maybeSingle()
      ).data as { id: string } | null,
  });

  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [birthday, setBirthday] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const start = useMutation({
    mutationFn: async () => {
      let client = found.data;
      if (!client) {
        const { data, error } = await supabase
          .from("clients")
          .insert({
            phone,
            name: name.trim(),
            gender: gender || null,
            birthday: birthday || null,
            notes: notes.trim() || null,
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);
        client = data as Client;
      }
      return rpc<Visit>("start_visit", { p_client: client.id });
    },
    onSuccess: (v) => nav(`/visit/${v.id}`, { replace: true }),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Screen title="New visit" back={<BackLink to="/" />}>
      <div className="space-y-2 pt-2">
        <label className="block text-center text-sm">
          Client's mobile number
          <input
            className="mt-2 min-h-16 w-full rounded-2xl border border-gray-300 bg-white px-4 text-center text-3xl font-semibold tracking-[0.18em] placeholder:text-base placeholder:font-normal placeholder:tracking-normal"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            placeholder="10-digit number"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
              setError("");
            }}
          />
        </label>
        <div className="flex items-center justify-between px-1 text-xs text-gray-500">
          <span>
            {ready
              ? found.isLoading
                ? "Searching…"
                : found.data
                  ? "Existing client found"
                  : "New client"
              : "We search automatically at 10 digits"}
          </span>
          <span className={ready ? "font-semibold text-violet-700" : ""}>
            {phone.length}/10
          </span>
        </div>
      </div>

      {!ready && (
        <Card className="space-y-1 border-dashed bg-gray-50 text-center shadow-none">
          <div className="text-3xl" aria-hidden>
            📱
          </div>
          <p className="font-medium">Start with the mobile number</p>
          <p className="text-sm text-gray-500">
            Returning clients show their dues, Prime status and last services. New numbers
            open a quick sign-up.
          </p>
        </Card>
      )}

      {ready && found.isSuccess && found.data && <ClientCard client={found.data} />}

      {ready && found.isSuccess && !found.data && (
        <Card className="space-y-3">
          <div className="font-semibold">New client</div>
          <label className="block text-sm">
            Name
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Gender (optional)
              <select
                className={inputCls}
                value={gender}
                onChange={(e) => setGender(e.target.value)}
              >
                <option value="">Not set</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="block text-sm">
              Birthday (optional)
              <input
                className={inputCls}
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
              />
            </label>
          </div>
          <p className="rounded-xl bg-violet-50 p-3 text-xs text-violet-800">
            🎂 Clients get 20% off all services on their birthday.
          </p>
          <label className="block text-sm">
            Notes (optional)
            <input
              className={inputCls}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </Card>
      )}

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <ActionBar>
        {openVisit.data ? (
          <Link
            to={`/visit/${openVisit.data.id}`}
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-violet-600 font-semibold text-white shadow-sm"
          >
            Open existing visit
          </Link>
        ) : (
          <Button
            disabled={
              !ready ||
              found.isLoading ||
              start.isPending ||
              (!found.data && !name.trim())
            }
            onClick={() => start.mutate()}
          >
            {start.isPending ? "Starting…" : "Start visit"}
          </Button>
        )}
      </ActionBar>
    </Screen>
  );
}
