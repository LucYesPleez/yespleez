import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  SectionCard, Button, ListRow, Tag,
  Textarea, Select, Toggle, Row,
} from '../design-system';
import s from './screens.module.css';

/**
 * SETTINGS — real UI, no behaviour.
 *
 * Every control is rendered and inert. What this screen settles is the shape
 * of a settings page in this product: what a group looks like, where its
 * actions sit, how a destructive action is separated from an ordinary one.
 *
 * ⭐ ROLES ARE FESTIVAL-WIDE in this milestone, and the copy says so. A
 * permission model people misunderstand is worse than a simple one they read
 * correctly — so the Team card states the limitation rather than implying a
 * scoping that does not exist yet.
 */

const TEAM = [
  { id: 'u1', name: 'Ben Anderson',   email: 'ben@northernskies.com',   role: 'Owner' },
  { id: 'u2', name: 'Sam Whitcombe',  email: 'sam@northernskies.com',   role: 'Admin' },
  { id: 'u3', name: 'Kate Ryan',      email: 'kate@northernskies.com',  role: 'Reviewer' },
  { id: 'u4', name: 'Jules Okafor',   email: 'jules@northernskies.com', role: 'Reviewer' },
];

/* A role is not an application status — it gets a Tag, not a StatusBadge.
   Owner reads strongest because it is the one role that cannot be removed. */
const ROLE_TONE = { Owner: 'green', Admin: 'purple', Reviewer: 'neutral' };

export default function SettingsScreen() {
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState({
    holdOutcomes: true,
    autoAck: true,
    emailDigest: false,
    pushDecisions: true,
  });

  const set = key => value => setPrefs(p => ({ ...p, [key]: value }));

  return (
    <div className={s.page}>
      <header className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Settings</h1>
          <p className={s.pageSubtitle}>
            How this festival handles applications, who can see them, and what leaves the platform.
          </p>
        </div>
      </header>

      {/**
        * ⭐⭐ YOU, NOT THE FESTIVAL. Everything else on this screen configures an
        * organisation; this row is the one thing here that belongs to the human
        * signed in, and it is separated rather than filed under Team for that
        * reason — a personal record listed among festival settings reads as
        * something the festival owns.
        *
        * ⛔ NOT A SIDEBAR ENTRY. Six rooms is the navigation law; this is a
        * route inside Settings, the same shape the event editor takes.
        */}
      <SectionCard
        title="You"
        subtitle="Yours, not this festival's. It travels with you to every festival you apply to."
      >
        <ListRow
          icon="volunteer"
          title="Your volunteer profile"
          meta="Experience, skills and qualifications. Answered once, reused every time."
          onClick={() => navigate('/settings/volunteer-profile')}
        />
      </SectionCard>

      <SectionCard
        title="Team"
        count={TEAM.length}
        subtitle="Roles apply to the whole festival. Per-category access is not available yet — a reviewer added here can see every category."
        actions={<Button variant="secondary" size="sm" icon="plus">Invite</Button>}
      >
        {TEAM.map(member => (
          <ListRow
            key={member.id}
            avatar
            title={member.name}
            meta={member.email}
            badge={<Tag tone={ROLE_TONE[member.role]}>{member.role}</Tag>}
            trail={
              <Button
                variant="ghost"
                size="sm"
                icon="dots"
                aria-label={`Manage ${member.name}`}
                disabled={member.role === 'Owner'}
              />
            }
          />
        ))}
      </SectionCard>

      <div className={s.settingsGrid}>
        <SectionCard title="Applications" subtitle="Defaults applied to every category unless a category overrides them.">
          <Toggle
            label="Hold outcomes until released"
            hint="Decisions stay private until you release them together. Turn this off and applicants are told the moment you decide."
            checked={prefs.holdOutcomes}
            onChange={set('holdOutcomes')}
          />
          <Toggle
            label="Send an acknowledgement on submit"
            hint="Applicants are told their application arrived. Silence on submit is the most common complaint about application processes."
            checked={prefs.autoAck}
            onChange={set('autoAck')}
          />
          <Textarea
            label="Default decline message"
            hint="Used when you decline without writing something personal. Nobody is ever declined by silence."
            defaultValue={
              'Thank you for taking the time to apply.\n\nWe received a large number of high-quality applications and, after careful review, we were unable to offer you a place this year.\n\nWe genuinely appreciate your interest and encourage you to apply again.'
            }
            rows={6}
          />
        </SectionCard>

        <div className={s.formStack}>
          <SectionCard title="Notifications" subtitle="What your team receives. Applicants have their own preferences.">
            <Toggle
              label="Daily email digest"
              hint="One summary a day instead of a notification per application."
              checked={prefs.emailDigest}
              onChange={set('emailDigest')}
            />
            <Toggle
              label="Push on decisions"
              hint="Only when someone on the team accepts or declines."
              checked={prefs.pushDecisions}
              onChange={set('pushDecisions')}
            />
          </SectionCard>

          <SectionCard
            title="Data"
            subtitle="Retention is set by the platform, not per festival, so the statement shown to applicants is always accurate."
            actions={<Button variant="secondary" size="sm" icon="export">Export all</Button>}
          >
            <Row>
              <Select
                label="Export format"
                options={[{ value: 'csv', label: 'CSV' }, { value: 'xlsx', label: 'Excel' }]}
              />
              <Select
                label="Include notes"
                hint="Messages are never exported."
                options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
              />
            </Row>
          </SectionCard>
        </div>
      </div>

      <SectionCard
        className={s.danger}
        title="Danger zone"
        subtitle="Only the Owner can do these, and none of them can be undone from here."
      >
        <ListRow
          icon="clock"
          title="Close all application categories"
          meta="Stops new applications immediately. Existing applications are untouched."
          trail={<Button variant="intent" tone="decline" size="sm">Close all</Button>}
        />
        <ListRow
          icon="profile"
          title="Transfer ownership"
          meta="The new Owner must accept. You become an Admin."
          trail={<Button variant="intent" tone="decline" size="sm">Transfer</Button>}
        />
        <ListRow
          icon="cross"
          title="Delete this festival"
          meta="Applications, decisions and history are removed. Applicants keep their own records."
          trail={<Button variant="intent" tone="decline" size="sm">Delete</Button>}
        />
      </SectionCard>
    </div>
  );
}
