import type { Metadata } from "next";
import KarlSite from "@/components/sites/karlgonsalves-com-83bf3ea7/root-8a5edab2/KarlSite";

export const metadata: Metadata = {
  title: "Karl",
  description: "I'm Karl, a motion designer.",
  icons: {
    icon: "/sites/karlgonsalves-com-83bf3ea7/root-8a5edab2/seo/favicon.png",
    apple: "/sites/karlgonsalves-com-83bf3ea7/root-8a5edab2/seo/webclip.png",
  },
};

export default function Home() {
  return <KarlSite />;
}
