"use client";

import { useId } from "react";

import { previewEarnings } from "@/lib/onboarding/price-preview";
import { SANDBOX_DEMO_RATES_NOTE } from "@/lib/sandbox/pricing";

type Props = {
  inputPerMillionUsd: string;
  outputPerMillionUsd: string;
  onChange: (field: "input" | "output", value: string) => void;
};

function PriceInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-[15px] font-bold text-ink">
        {label}
      </label>
      <div className="flex items-center rounded border-2 border-line-strong bg-paper focus-within:border-ink">
        <span aria-hidden="true" className="pl-3 text-ink-muted">
          $
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0.00"
          size={1}
          className="w-full min-w-0 flex-1 bg-transparent px-3 py-3 text-ink placeholder:text-ink-muted focus:outline-none"
        />
        <span className="pr-3 text-sm text-ink-muted">USD</span>
      </div>
    </div>
  );
}

/**
 * The price step of provider onboarding: input and output price per million
 * tokens, with what one typical call would earn at that price.
 */
export function ProviderPriceFields({ inputPerMillionUsd, outputPerMillionUsd, onChange }: Props) {
  const id = useId();
  const preview = previewEarnings(inputPerMillionUsd, outputPerMillionUsd);

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="space-y-4 rounded-md border border-line bg-paper p-4 sm:p-5"
      data-testid="provider-price-fields"
    >
      <div className="space-y-2">
        <h3 id={`${id}-heading`} className="text-2xl">
          Set your price per token
        </h3>
        <p className="max-w-2xl text-[15px] leading-relaxed text-ink-muted">
          Buyers see this price before they call you. They approve a maximum per call, you settle
          what the call actually used, and the rest goes back to them. You can change it later.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <PriceInput
          id={`${id}-input`}
          label="Input, per million tokens"
          value={inputPerMillionUsd}
          onChange={(value) => onChange("input", value)}
        />
        <PriceInput
          id={`${id}-output`}
          label="Output, per million tokens"
          value={outputPerMillionUsd}
          onChange={(value) => onChange("output", value)}
        />
      </div>

      <div
        className="rounded-md border border-line bg-[#101216] p-5 font-mono text-sm text-[#ece9df]"
        aria-live="polite"
        data-testid="provider-price-preview"
      >
        <p className="mb-3 text-xs font-bold tracking-[0.06em] text-[#14f195]">
          WHAT A TYPICAL CALL EARNS YOU · {(preview?.usage.inputTokens ?? 12_000).toLocaleString("en-US")} IN,{" "}
          {(preview?.usage.outputTokens ?? 1_500).toLocaleString("en-US")} OUT
        </p>
        {preview ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <dt className="text-[#b9b6ab]">Buyer pays</dt>
            <dd className="m-0 break-words">
              {preview.buyerPays.usdc} USDC · {preview.buyerPays.audd} AUDD · {preview.buyerPays.sol} SOL
            </dd>
            <dt className="text-[#b9b6ab]">Protocol fee (planned, 2.5% launch rate, then 5%)</dt>
            <dd className="m-0">{preview.feeUsdc} USDC</dd>
            <dt className="text-[#b9b6ab]">You receive</dt>
            <dd className="m-0 font-bold text-[#14f195]">{preview.providerReceivesUsdc} USDC</dd>
          </dl>
        ) : (
          <p className="text-[#b9b6ab]">Enter both prices to see what one call earns.</p>
        )}
        <p className="mt-3 text-xs text-[#b9b6ab]">
          {SANDBOX_DEMO_RATES_NOTE} The fee starts with the mainnet release.
        </p>
      </div>
    </section>
  );
}
