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
    <>
      <div className="cell-muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
        Contract: {moneyUsd(contractAmount)}
      </div>
      <div className="cell-muted" style={{ fontSize: "0.75rem" }}>
        Paid: {amountPaid == null ? "—" : moneyUsd(amountPaid)}
      </div>
    </>
  );
}
