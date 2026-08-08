import { useParams, Navigate } from 'react-router-dom';

/**
 * `/messages/:id` — an ENTRY POINT, not a page.
 *
 * The canonical model has exactly two concepts: the conversation LIST (the
 * home of messaging) and the ConversationDock (the workspace). There is no
 * second conversation page and no secondary inbox — that split was the thing
 * making Messaging behave like a drawer and a separate app at once.
 *
 * This route survives only so an external link still lands somewhere sensible:
 * a notification deep link, a shared URL, a bookmark. It opens the dock and
 * redirects to the list, so the user arrives in the one messaging environment
 * rather than a parallel one that looks almost the same.
 *
 * Nothing inside the app should link here. The list opens conversations
 * directly through `useConversationUi().open`, with no navigation and no URL
 * change — navigating is the context switch the model exists to avoid.
 */
export default function ConversationScreen() {
  const { id } = useParams();

  // The id travels as navigation STATE rather than being opened here. Opening
  // first would race the dock's minimise-on-navigation rule — this component
  // redirects, the path changes, and the dock would close the conversation it
  // had just opened. Letting the list open it after the route settles avoids
  // fighting that rule instead of special-casing it.
  return <Navigate to="/messages" replace state={{ openConversation: id }} />;
}
