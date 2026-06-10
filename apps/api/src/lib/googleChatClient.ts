import axios from 'axios';
import { logger } from './logger';

const pkg = require('../../package.json');

interface GoogleChatCard {
  cardId: string;
  card: {
    header?: {
      title: string;
      subtitle?: string;
      imageUrl?: string;
      imageType?: 'CIRCLE' | 'SQUARE';
    };
    sections?: Array<{
      header?: string;
      widgets?: Array<any>;
    }>;
  };
}

interface GoogleChatMessage {
  cardsV2?: GoogleChatCard[];
  text?: string;
}

/**
 * Send a message to a Google Chat space via webhook
 */
export async function sendGoogleChatMessage(
  webhookUrl: string,
  message: GoogleChatMessage
): Promise<void> {
  if (!webhookUrl) {
    logger.warn('[GoogleChat] No webhook URL provided, skipping notification');
    return;
  }

  try {
    const response = await axios.post(webhookUrl, message, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.status !== 200) {
      throw new Error(`Google Chat webhook failed: ${response.status}`);
    }

    logger.info('[GoogleChat] Message sent successfully');
  } catch (error: any) {
    logger.error(`[GoogleChat] Error sending message: ${error.message}`);
    throw error;
  }
}

/**
 * Simple helper to strip HTML tags from a string
 */
function stripHtml(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]*>?/gm, '').trim();
}

/**
 * Build a formatted notification card for new issue assignment based on wireframe
 */
export function buildIssueNotificationCard(params: {
  issueNumber: number;
  projectName: string;
  projectUrl?: string;
  isPreRelease?: boolean;
  category?: string;
  description?: string;
  issueHeading: string;
  findingsUrl: string;
  tagIds: string[];
  thumbnails?: string[];
}): GoogleChatMessage {
  const { 
    issueNumber, 
    projectName, 
    projectUrl, 
    isPreRelease, 
    category, 
    description, 
    issueHeading, 
    findingsUrl, 
    tagIds,
    thumbnails 
  } = params;

  // Create mentions string
  const mentions = tagIds.map(id => `<users/${id}>`).join(' ');

  // Truncate stripped description to 25 chars
  const cleanDescription = stripHtml(description || '');
  const truncatedDesc = cleanDescription 
    ? (cleanDescription.length > 300 ? cleanDescription.substring(0, 300) + '...' : cleanDescription)
    : '';

  const cleanHeading = stripHtml(issueHeading || '');

  const sections: any[] = [
    {
      widgets: [
        {
          columns: {
            columnItems: [
              {
                horizontalSizeStyle: "FILL_AVAILABLE_SPACE",
                widgets: [
                  {
                    textParagraph: {
                      text: `<b>New Issue Assigned</b><br><font color=\"#666666\">${projectName}${projectUrl ? ` - <a href=\"${projectUrl}\">${projectUrl}</a>` : ""}</font>`
                    }
                  }
                ]
              },
              {
                horizontalAlignment: "END",
                widgets: [
                  {
                    textParagraph: {
                      text: `<font color=\"#888888\">${isPreRelease ? "pre-release" : "post-release"}</font>`
                    }
                  }
                ]
              }
            ]
          }
        },
        {
          columns: {
            columnItems: [
              {
                horizontalSizeStyle: "FILL_AVAILABLE_SPACE",
                widgets: [
                  {
                    textParagraph: {
                      text: `<b>Issue #${issueNumber}</b>`
                    }
                  }
                ]
              },
              {
                horizontalAlignment: "END",
                widgets: [
                  {
                    textParagraph: {
                      text: `<b>${category || "Finding"}</b>`
                    }
                  }
                ]
              }
            ]
          }
        },
        {
          textParagraph: {
            text: `<b>${cleanHeading}</b><br><font color=\"#444444\">${truncatedDesc}</font>`
          }
        }
      ]
    }
  ];

  // Add thumbnails grid if any
  if (thumbnails && thumbnails.length > 0) {
    sections.push({
      widgets: [
        {
          grid: {
            columnCount: 3,
            items: thumbnails.slice(0, 3).map((url, i) => ({
              id: `thumb-${i}`,
              image: {
                imageUri: url,
                cropStyle: {
                  type: "RECTANGLE_4_3"
                }
              }
            }))
          }
        }
      ]
    });
  }

  // Add Action Section
  sections.push({
    widgets: [
      {
        buttonList: {
          buttons: [
            {
              text: 'View task',
              onClick: {
                openLink: {
                  url: findingsUrl,
                },
              },
            },
          ],
        },
      },
    ]
  });

  return {
    text: mentions ? `Attention: ${mentions}` : undefined,
    cardsV2: [
      {
        cardId: `issue-${issueNumber}-${Date.now()}`,
        card: {
          sections: sections
        },
      },
    ],
  };
}
