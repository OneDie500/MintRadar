import SetsClient from "./SetsClient";

type SetsPageProps = {
  searchParams: Promise<{
    category?: string | string[];
  }>;
};

export default async function BrowseSetsPage({
  searchParams,
}: SetsPageProps) {
  const params = await searchParams;
  const category =
    typeof params.category === "string"
      ? params.category
      : Array.isArray(params.category)
        ? params.category[0]
        : undefined;

  return <SetsClient initialCategorySlug={category} />;
}
