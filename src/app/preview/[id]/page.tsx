import PreviewRuntime from "./PreviewRuntime";

export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  return <PreviewRuntime projectId={id} token={query.token ?? ""} />;
}
