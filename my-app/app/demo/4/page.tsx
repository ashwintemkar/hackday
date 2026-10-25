"use client";

import { StoryConsole } from "@/components/demo/StoryConsole";
import { script } from "./script";

export default function ServerMemoryDegradationDemo() {
  return <StoryConsole demo={script} />;
}
