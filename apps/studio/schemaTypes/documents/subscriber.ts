import { Mail } from "lucide-react";
import { defineField, defineType } from "sanity";

export const subscriber = defineType({
  name: "subscriber",
  type: "document",
  title: "Subscriber",
  description:
    "A newsletter signup. Created by POST /api/newsletter, not by hand.",
  icon: Mail,
  fields: [
    defineField({
      name: "email",
      type: "string",
      title: "Email",
      description: "Stored trimmed and lowercased.",
      // The document _id is derived from this value, so editing it here
      // would break duplicate detection.
      readOnly: true,
      validation: (Rule) => Rule.required().email(),
    }),
    defineField({
      name: "subscribedAt",
      type: "datetime",
      title: "Subscribed at",
      readOnly: true,
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "source",
      type: "string",
      title: "Source page",
      description: "Path of the page the form was submitted from.",
      readOnly: true,
    }),
    defineField({
      name: "optedOut",
      type: "boolean",
      title: "Opted out",
      description: "Do not send. The record is kept, never deleted.",
      initialValue: false,
    }),
    defineField({
      name: "optedOutAt",
      type: "datetime",
      title: "Opted out at",
      readOnly: true,
      hidden: ({ document }) => !document?.optedOut,
    }),
  ],
  preview: {
    select: {
      email: "email",
      subscribedAt: "subscribedAt",
      optedOut: "optedOut",
    },
    prepare: ({ email, subscribedAt, optedOut }) => ({
      title: email || "No email",
      subtitle: [
        optedOut ? "Opted out" : "Active",
        subscribedAt ? new Date(subscribedAt).toLocaleDateString() : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }),
  },
});
