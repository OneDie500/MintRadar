"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  P31SWebPrinter,
  P31S_CANVAS_HEIGHT,
  P31S_CANVAS_WIDTH,
  supportsWebBluetooth,
} from "../../../lib/p31s-web";

const printer = new P31SWebPrinter();

function drawLabel(
  canvas: HTMLCanvasElement,
  name: string,
  meta: string,
  condition: string,
  price: string
) {
  canvas.width = P31S_CANVAS_WIDTH;
  canvas.height = P31S_CANVAS_HEIGHT;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  ctx.font = "700 10px Arial";
  ctx.fillText("MINT RADAR", 8, 5);

  ctx.font = "900 22px Arial";
  ctx.fillText(name || "MINT RADAR TEST", 8, 20);

  ctx.font = "700 12px Arial";
  ctx.fillText(meta || "P31S • 14x40mm", 8, 50);

  ctx.fillRect(8, 69, 304, 2);

  ctx.font = "900 18px Arial";
  ctx.fillText(condition || "NM", 8, 78);

  if (price.trim()) {
    ctx.textAlign = "right";
    ctx.font = "900 22px Arial";
    ctx.fillText(price.startsWith("$") ? price : `$${price}`, 312, 76);
    ctx.textAlign = "left";
  }
}

export default function P31SPrinterTestPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [name, setName] = useState("MINT RADAR TEST");
  const [meta, setMeta] = useState("P31S • 14x40mm");
  const [condition, setCondition] = useState("NM");
  const [price, setPrice] = useState("25.00");
  const [supported, setSupported] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => setSupported(supportsWebBluetooth()), []);

  useEffect(() => {
    if (canvasRef.current) {
      drawLabel(canvasRef.current, name, meta, condition, price);
    }
  }, [name, meta, condition, price]);

  async function connect() {
    setBusy(true);
    setStatus("");

    try {
      const deviceName = await printer.connect();
      setConnected(true);
      setStatus(`Connected to ${deviceName}.`);
    } catch (error: any) {
      setConnected(false);
      setStatus(error?.message || "Could not connect to the P31S.");
    } finally {
      setBusy(false);
    }
  }

  async function printTest() {
    if (!canvasRef.current) return;

    setBusy(true);
    setStatus("");

    try {
      await printer.printCanvas(canvasRef.current);
      setStatus("Print data sent to the P31S.");
    } catch (error: any) {
      setStatus(error?.message || "Print failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-black px-4 pb-16 pt-20 text-white sm:px-5 sm:pt-24">
      <div className="mx-auto max-w-4xl">
        <Link href="/vendor" className="text-sm font-black text-zinc-500 hover:text-emerald-300">
          ← Vendor Dashboard
        </Link>

        <p className="mt-8 text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
          MintRadar Printer Lab
        </p>

        <h1 className="mt-2 text-4xl font-black">Polono P31S</h1>

        <p className="mt-3 max-w-2xl text-zinc-500">
          14 × 40 mm direct Bluetooth test. The preview works now even without Bluetooth hardware.
        </p>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="rounded-3xl border border-zinc-900 bg-zinc-950 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["Title", name, setName],
                ["Meta", meta, setMeta],
                ["Condition", condition, setCondition],
                ["Price", price, setPrice],
              ].map(([label, value, setter]) => (
                <label key={label as string}>
                  <span className="text-xs font-black uppercase tracking-wider text-zinc-600">
                    {label as string}
                  </span>
                  <input
                    value={value as string}
                    onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 font-bold outline-none focus:border-emerald-400/50"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-900 bg-zinc-950 p-5">
            <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
              Preview
            </p>

            <div className="mt-4 overflow-hidden rounded-xl bg-white p-2">
              <canvas
                ref={canvasRef}
                width={P31S_CANVAS_WIDTH}
                height={P31S_CANVAS_HEIGHT}
                className="h-auto w-full [image-rendering:pixelated]"
              />
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-zinc-900 bg-zinc-950 p-5">
          {!supported && (
            <div className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm font-bold text-amber-200">
              No Web Bluetooth on this device/browser. The page is still fully staged for later testing.
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {!connected ? (
              <button
                type="button"
                onClick={() => void connect()}
                disabled={!supported || busy}
                className="rounded-xl bg-emerald-400 px-5 py-3 font-black text-black disabled:opacity-40"
              >
                {busy ? "Connecting..." : "Connect P31S"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void printTest()}
                  disabled={busy}
                  className="rounded-xl bg-emerald-400 px-5 py-3 font-black text-black disabled:opacity-40"
                >
                  {busy ? "Printing..." : "Print Test Label"}
                </button>

                <button
                  type="button"
                  onClick={() => void printer.disconnect().then(() => setConnected(false))}
                  className="rounded-xl border border-zinc-800 bg-black px-5 py-3 font-black text-zinc-400"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>

          {status && <p className="mt-4 text-sm font-bold text-zinc-400">{status}</p>}
        </section>
      </div>
    </main>
  );
}
