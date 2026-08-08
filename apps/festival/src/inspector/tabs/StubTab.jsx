import { SectionCard, LoadingState } from '../../design-system';

/**
 * A tab that exists and is not built yet.
 *
 * Its own file so `registry.jsx` exports only data — a module that exports
 * both a component and a value breaks React Fast Refresh, and the registry is
 * the file most likely to be edited while the app is running.
 */
export default function StubTab({ title, note }) {
  return (
    <SectionCard title={title} subtitle={note}>
      <LoadingState lines={4} />
    </SectionCard>
  );
}
