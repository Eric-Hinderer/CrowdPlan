import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CrowdPlan",
    short_name: "CrowdPlan",
    description: "Tell CrowdPlan what your group has already figured out. CrowdPlan figures out the rest.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f6fb",
    theme_color: "#5b3df5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
