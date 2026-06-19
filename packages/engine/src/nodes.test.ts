import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isConditionType,
  isEventCondition,
  isOrchestrationNode,
  nodeToActionType,
} from "./nodes";

test("nodeToActionType maps transport nodes and ignores others", () => {
  assert.equal(nodeToActionType("send_connection_request"), "connection_request");
  assert.equal(nodeToActionType("send_message"), "message");
  assert.equal(nodeToActionType("comment_last_post"), "comment_post");
  assert.equal(nodeToActionType("like_last_post"), "like_post");
  assert.equal(nodeToActionType("send_message_to_open_profile"), "open_profile_message");
  assert.equal(nodeToActionType("wait_x_days"), null);
  assert.equal(nodeToActionType("add_tag"), null);
  assert.equal(nodeToActionType("invite_accepted"), null);
});

test("isOrchestrationNode covers add_tag + wait_x_days only", () => {
  assert.equal(isOrchestrationNode("add_tag"), true);
  assert.equal(isOrchestrationNode("wait_x_days"), true);
  assert.equal(isOrchestrationNode("send_message"), false);
});

test("condition + event-condition classification", () => {
  assert.equal(isConditionType("invite_accepted"), true);
  assert.equal(isConditionType("has_linkedin_url"), true);
  assert.equal(isConditionType("send_message"), false);

  assert.equal(isEventCondition("invite_accepted"), true);
  assert.equal(isEventCondition("message_replied"), true);
  assert.equal(isEventCondition("has_linkedin_url"), false); // static
});
