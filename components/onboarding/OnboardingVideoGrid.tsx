import { OnboardingVideoCard } from "@/components/onboarding/OnboardingVideoCard";
import type { OnboardingVideoGuide } from "@/lib/onboarding/video-guides";

export function OnboardingVideoGrid({
  videos,
  hostRoute,
}: {
  videos: OnboardingVideoGuide[];
  hostRoute?: string;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {videos.map((video) => (
        <OnboardingVideoCard key={video.id} video={video} hostRoute={hostRoute} />
      ))}
    </div>
  );
}
