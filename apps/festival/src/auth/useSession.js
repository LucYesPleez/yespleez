import { useContext } from 'react';
import { SessionContext } from './sessionContext';

/** The signed-in organiser, or nulls while signed out. */
export function useSession() {
  return useContext(SessionContext);
}
