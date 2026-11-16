/**
 * Typography for rendered markdown, scoped with arbitrary variants so the
 * module needs no global CSS. Compact, like the rest of Planuj Glass.
 */
export const proseClass = [
  "text-sm leading-6 text-foreground break-words",
  "[&>*+*]:mt-3",
  "[&_h1]:font-display [&_h1]:text-xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:mt-6",
  "[&_h2]:font-display [&_h2]:text-lg [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:mt-6",
  "[&_h3]:font-display [&_h3]:text-base [&_h3]:font-bold [&_h3]:mt-5",
  "[&_h4]:font-semibold [&_h4]:mt-4",
  "[&>:first-child]:mt-0",
  "[&_a]:text-text-accent [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:no-underline",
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li+li]:mt-1",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-accent-500 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px]",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_hr]:border-hairline [&_hr]:my-6",
  "[&_img]:max-w-full [&_img]:rounded-lg",
  "[&_table]:w-full [&_table]:text-left [&_th]:border-b [&_th]:border-hairline [&_th]:py-1.5 [&_th]:pr-3 [&_th]:text-meta [&_th]:text-muted-foreground [&_td]:border-b [&_td]:border-hairline [&_td]:py-1.5 [&_td]:pr-3",
].join(" ")
