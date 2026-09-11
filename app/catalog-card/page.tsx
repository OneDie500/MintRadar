import CatalogCardClient from "./CatalogCardClient";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CatalogCardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const rookieRaw = first(params.rookie);
  const printRunRaw = first(params.print_run);

  const card = {
    external_id: first(params.external_id) || "",
    data_source: first(params.data_source) || "",
    name: first(params.name) || "Unknown Collectible",
    set_name: first(params.set_name) || null,
    card_number: first(params.card_number) || null,
    image_url: first(params.image_url) || null,
    category: first(params.category) || null,
    rarity: first(params.rarity) || null,
    edition: first(params.edition) || null,
    finish: first(params.finish) || null,
    year: first(params.year) || null,
    manufacturer: first(params.manufacturer) || null,
    release_name: first(params.release_name) || null,
    parallel_name: first(params.parallel_name) || null,
    sport: first(params.sport) || null,
    print_run:
      printRunRaw && Number.isFinite(Number(printRunRaw))
        ? Number(printRunRaw)
        : null,
    rookie:
      rookieRaw === "true"
        ? true
        : rookieRaw === "false"
          ? false
          : null,
  };

  return <CatalogCardClient card={card} />;
}
