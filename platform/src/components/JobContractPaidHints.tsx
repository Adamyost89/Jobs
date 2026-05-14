function moneyUsd(n: number): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function JobContractPaidHints({
  contractAmount,
  amountPaid,
}: {
  contractAmount: number;
  amountPaid: number | null;
}) {
  return (
    <div className="job-financial-hints" aria-label="Job contract and amount paid">
      <div className="job-financial-hints__line">
        <span className="job-financial-hints__label">Contract</span>
        <span className="job-financial-hints__value">{moneyUsd(contractAmount)}</span>
      </div>
      <div className="job-financial-hints__line">
        <span className="job-financial-hints__label">Paid</span>
        <span className="job-financial-hints__value">
          {amountPaid == null ? "—" : moneyUsd(amountPaid)}
        </span>
      </div>
    </div>
  );
}
