"use client";

import { useMemo, useState } from "react";

const QUICK_PERCENTAGES = [70, 75, 80, 85, 90, 100];

function cleanNumber(value: string) {
  const normalized = value.replace(/[$,%\s]/g, "");

  if (!normalized) {
    return 0;
  }

  const number = Number(normalized);

  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function TradeAnalyzer() {
  const [marketValue, setMarketValue] = useState("");
  const [tradePercentage, setTradePercentage] = useState(80);

  const numericMarketValue = useMemo(
    () => Math.max(0, cleanNumber(marketValue)),
    [marketValue]
  );

  const tradeValue = useMemo(
    () =>
      numericMarketValue *
      (Math.max(0, tradePercentage) / 100),
    [numericMarketValue, tradePercentage]
  );

  function choosePercentage(percentage: number) {
    setTradePercentage(percentage);
  }

  function resetAnalyzer() {
    setMarketValue("");
    setTradePercentage(80);
  }

  return (
    <section className="mb-8 overflow-hidden rounded-3xl border border-emerald-400/20 bg-zinc-950">
      <div className="border-b border-zinc-900 bg-emerald-400/[0.04] px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-400">
              📡 Trade Analyzer
            </p>

            <h2 className="mt-2 text-2xl font-black text-white">
              Run the numbers.
            </h2>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
              Enter the card&apos;s market value and choose the
              percentage you&apos;re trading at.
            </p>
          </div>

          <button
            type="button"
            onClick={resetAnalyzer}
            className="self-start rounded-xl border border-zinc-800 bg-black px-4 py-2.5 text-sm font-black text-zinc-400 transition hover:border-zinc-700 hover:text-white sm:self-auto"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_1.2fr_1fr]">
        <div>
          <label
            htmlFor="trade-market-value"
            className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500"
          >
            Market Value
          </label>

          <div className="mt-2 flex items-center rounded-2xl border border-zinc-800 bg-black transition focus-within:border-emerald-400/50">
            <span className="pl-4 text-xl font-black text-zinc-600">
              $
            </span>

            <input
              id="trade-market-value"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={marketValue}
              onChange={(event) =>
                setMarketValue(event.target.value)
              }
              placeholder="100.00"
              className="min-w-0 flex-1 bg-transparent px-3 py-4 text-2xl font-black text-white outline-none placeholder:text-zinc-800"
            />
          </div>
        </div>

        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
            Trade Percentage
          </p>

          <div className="mt-2 grid grid-cols-3 gap-2">
            {QUICK_PERCENTAGES.map((percentage) => {
              const selected =
                tradePercentage === percentage;

              return (
                <button
                  key={percentage}
                  type="button"
                  onClick={() =>
                    choosePercentage(percentage)
                  }
                  className={`rounded-xl border px-3 py-3 text-sm font-black transition ${
                    selected
                      ? "border-emerald-400 bg-emerald-400 text-black"
                      : "border-zinc-800 bg-black text-zinc-400 hover:border-emerald-400/40 hover:text-emerald-300"
                  }`}
                >
                  {percentage}%
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <label
              htmlFor="trade-custom-percentage"
              className="shrink-0 text-xs font-black uppercase tracking-[0.12em] text-zinc-600"
            >
              Custom
            </label>

            <div className="flex min-w-0 flex-1 items-center rounded-xl border border-zinc-800 bg-black focus-within:border-emerald-400/50">
              <input
                id="trade-custom-percentage"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={tradePercentage}
                onChange={(event) => {
                  const nextValue = Number(
                    event.target.value
                  );

                  setTradePercentage(
                    Number.isFinite(nextValue)
                      ? Math.max(0, nextValue)
                      : 0
                  );
                }}
                className="min-w-0 flex-1 bg-transparent px-3 py-3 text-right font-black text-white outline-none"
              />

              <span className="pr-3 font-black text-zinc-600">
                %
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center rounded-2xl border border-emerald-400/20 bg-black p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">
            Trade Value
          </p>

          <p className="mt-2 text-4xl font-black tracking-tight text-emerald-400">
            ${formatMoney(tradeValue)}
          </p>

          <div className="mt-3 border-t border-zinc-900 pt-3">
            <p className="text-xs text-zinc-600">
              ${formatMoney(numericMarketValue)} at{" "}
              <span className="font-black text-zinc-400">
                {tradePercentage}%
              </span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}