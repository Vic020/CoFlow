import Image from "next/image";

/** Shared vector mark used by the sidebar and mobile navigation. */
export function CoFlowLogo() {
  return (
    <Image
      src="/brand/coflow-logo.svg"
      alt=""
      width={40}
      height={32}
      unoptimized
    />
  );
}
