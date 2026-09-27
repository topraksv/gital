/**
 * Posting a report to the function that mails it (SPEC 13.1), Helix's
 * `services/feedback.ts`. What it owns is telling apart the answers a person
 * can act on: a build with no cloud, a session gone, a limit to wait out, and
 * everything else, which keeps the draft for another try.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";

import { feedbackMessageRejection, isFeedbackCategory, MAX_FEEDBACK_IMAGES, type FeedbackCategory } from "../domain/feedback";
import { getSupabase } from "../sync/supabase";

export type FeedbackResult = "sent" | "unconfigured" | "unauthenticated" | "rateLimited" | "failed";

export interface FeedbackSubmission {
  category: FeedbackCategory;
  message: string;
  /** Screenshots as the photo picker gives them: JPEG data URIs. */
  images: readonly string[];
}

const DATA_URI = /^data:(image\/jpeg);base64,(.+)$/;

export async function sendFeedback(submission: FeedbackSubmission): Promise<FeedbackResult> {
  const supabase = getSupabase();
  if (!supabase) return "unconfigured";
  // Checked again here: the form is not the only thing that could call this.
  if (!isFeedbackCategory(submission.category) || feedbackMessageRejection(submission.message) !== null) return "failed";
  const images = submission.images.map((uri) => DATA_URI.exec(uri));
  if (images.length > MAX_FEEDBACK_IMAGES || images.some((image) => !image)) return "failed";
  if (!(await supabase.auth.getSession()).data.session) return "unauthenticated";
  try {
    const { error } = await supabase.functions.invoke("send-feedback", {
      body: {
        category: submission.category,
        message: submission.message.trim(),
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version ?? "bilinmiyor",
        images: images.map((image, at) => ({ mimeType: image![1], filename: `ekran-goruntusu-${at + 1}.jpg`, base64: image![2] })),
      },
    });
    if (!error) return "sent";
    // The function answers a limit with 429 and nothing else does; the status is the contract.
    return (error as { context?: { status?: number } }).context?.status === 429 ? "rateLimited" : "failed";
  } catch {
    return "failed";
  }
}
