import { getSession } from "@/lib/session";
import { canViewHrPayroll } from "@/lib/rbac";
import { CommissionSubnav } from "@/components/CommissionSubnav";

export default async function CommissionsSectionLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  const showPayroll = Boolean(user && canViewHrPayroll(user));

  return (
    <>
      <CommissionSubnav showPayroll={showPayroll} />
      {children}
    </>
  );
}
