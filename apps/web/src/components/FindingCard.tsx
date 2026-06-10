import React from "react"
import { QAFinding } from "../api/runs.api"
import { SpellingFindingCard } from "./SpellingFindingCard"
import { PrivacyPolicyFindingCard } from "./PrivacyPolicyFindingCard"
import { ProjectPlanFindingCard } from "./ProjectPlanFindingCard"
import { HeroMediaFindingCard } from "./HeroMediaFindingCard"
import { DeadLinksFindingCard } from "./DeadLinksFindingCard"
import { DefaultFindingCard } from "./DefaultFindingCard"
import { LogoCheckFindingCard } from "./LogoCheckFindingCard"
import { SingleScriptFindingCard } from "./SingleScriptFindingCard"
import { HeaderFindingCard } from "./HeaderFindingCard"
import { CallnowFindingCard } from "./CallnowFindingCard"
import { PaidMediaFindingCard } from "./PaidMediaFindingCard"
import { LearnMoreButtonsFindingCard } from "./LearnMoreButtonsFindingCard"
import { UrlTabCompareFindingCard } from "./UrlTabCompareFindingCard"
import { PluginUpdatesFindingCard } from "./PluginUpdatesFindingCard"
import { SocialShareHeadingFindingCard } from "./SocialShareHeadingFindingCard"
import { FaviconFindingCard } from "./FaviconFindingCard"
import { ContactFormFindingCard } from "./ContactFormFindingCard"
import { LogoOnChatbotFindingCard } from "./LogoOnChatbotFindingCard"

interface FindingCardProps {
  finding: QAFinding
  pageScreenshots?: {
    desktop?: string | null
    tablet?: string | null
    mobile?: string | null
  }
  onConfirm?: (id: string) => void
  onFalsePositive?: (id: string) => void
  onCreateTask?: (finding: QAFinding) => void
  onAssign?: (id: string) => void
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  assignedTaskIds?: string[]
  assignedUsers?: any[]
  isAssigned?: boolean
}

export const FindingCard: React.FC<FindingCardProps> = (props) => {
  const { finding } = props

  if (finding.check_factor === "spelling") {
    return (
      <SpellingFindingCard
        finding={props.finding}
        pageScreenshots={props.pageScreenshots}
        onConfirm={props.onConfirm}
        onFalsePositive={props.onFalsePositive}
        onCreateTask={props.onCreateTask}
        assignedTaskIds={props.assignedTaskIds}
        assignedUsers={props.assignedUsers}
        isAssigned={props.isAssigned}
      />
    )
  }

  if (finding.check_factor === "privacy_policy") {
    return <PrivacyPolicyFindingCard {...props} />
  }

  if (finding.check_factor === "project_plan") {
    return <ProjectPlanFindingCard {...props} />
  }

  if (finding.check_factor === "hero_media") {
    return <HeroMediaFindingCard {...props} />
  }

  if (finding.check_factor === "dead_links") {
    return <DeadLinksFindingCard {...props} />
  }

  if (finding.check_factor === "footer_logo") {
    return <LogoCheckFindingCard {...props} />
  }

  if (finding.check_factor === "single_script") {
    return <SingleScriptFindingCard {...props} />
  }

  if (finding.check_factor === "top_bar_sticky") {
    return <HeaderFindingCard {...props} />
  }

  if (finding.check_factor === "callnow_links") {
    return <CallnowFindingCard {...props} />
  }

  if (finding.check_factor === "paid_media") {
    return <PaidMediaFindingCard {...props} />
  }

  if (finding.check_factor === "learn_more_buttons") {
    return <LearnMoreButtonsFindingCard {...props} />
  }

  if (finding.check_factor === "url_tab_compare") {
    return <UrlTabCompareFindingCard {...props} />
  }

  if (finding.check_factor === "verify_plugin_updates") {
    return <PluginUpdatesFindingCard {...props} />
  }

  if (finding.check_factor === "verify_plugin_updates") {
    return <PluginUpdatesFindingCard {...props} />
  }

  if (finding.check_factor === "social_share_heading") {
    return <SocialShareHeadingFindingCard {...props} />
  }

  if (finding.check_factor === "favicon") {
    return <FaviconFindingCard {...props} />
  }

  if (finding.check_factor === "contact_form") {
    return <ContactFormFindingCard {...props} />
  }

  if (finding.check_factor === "logo_chatbot") {
    return <LogoOnChatbotFindingCard {...props} />
  }

  // Fallback for everything else (Paid Media, Generic, SEO, etc.)
  return <DefaultFindingCard {...props} />
}
