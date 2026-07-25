import json
import logging
import os
import sys
from pprint import pformat
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult


LOGGER_NAME = "agent.orchestrator"
logger = logging.getLogger(LOGGER_NAME)


def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off", ""}


def verbose_enabled() -> bool:
    return _env_flag("AGENT_VERBOSE", True)


def llm_message_logging_enabled() -> bool:
    return _env_flag("AGENT_LOG_LLM_MESSAGES", True)


def _max_chars() -> int | None:
    if _env_flag("AGENT_LOG_FULL", True):
        return None

    raw = os.getenv("AGENT_LOG_MAX_CHARS", "3000")
    try:
        value = int(raw)
    except ValueError:
        value = 3000
    return max(value, 0)


def configure_agent_logging() -> None:
    """Route agent logs to the VS Code terminal/stdout with UTF-8 output."""
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    logger.setLevel(logging.INFO if verbose_enabled() else logging.WARNING)
    logger.propagate = False

    formatter = logging.Formatter(
        "[INFO] %(asctime)s %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    for handler in logger.handlers:
        if getattr(handler, "_agent_console_handler", False):
            handler.setLevel(logging.INFO)
            handler.setFormatter(formatter)
            return

    handler = logging.StreamHandler(sys.stdout)
    handler._agent_console_handler = True
    handler.setLevel(logging.INFO)
    handler.setFormatter(formatter)
    logger.addHandler(handler)


def _trim(text: str) -> str:
    limit = _max_chars()
    if limit is None or len(text) <= limit:
        return text
    hidden = len(text) - limit
    return f"{text[:limit]}\n...[truncated {hidden} chars; set AGENT_LOG_FULL=1 to print all]"


def _render_value(value: Any) -> str:
    if isinstance(value, str):
        return _trim(value)
    try:
        return _trim(json.dumps(value, ensure_ascii=False, indent=2, default=str))
    except TypeError:
        return _trim(pformat(value, width=120))


def _message_to_dict(message: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "type": getattr(message, "type", type(message).__name__),
        "content": getattr(message, "content", str(message)),
    }

    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls:
        data["tool_calls"] = tool_calls

    name = getattr(message, "name", None)
    if name:
        data["name"] = name

    tool_call_id = getattr(message, "tool_call_id", None)
    if tool_call_id:
        data["tool_call_id"] = tool_call_id

    additional_kwargs = getattr(message, "additional_kwargs", None)
    if additional_kwargs:
        data["additional_kwargs"] = additional_kwargs

    return data


def _render_messages(messages: Any) -> str:
    rendered_batches = []
    for batch_index, batch in enumerate(messages):
        rendered = [_message_to_dict(message) for message in batch]
        rendered_batches.append(f"batch={batch_index}\n{_render_value(rendered)}")
    return "\n\n".join(rendered_batches)


def _render_llm_result(response: LLMResult) -> str:
    generations = []
    for batch in response.generations:
        batch_items = []
        for generation in batch:
            message = getattr(generation, "message", None)
            if message is not None:
                batch_items.append(_message_to_dict(message))
            else:
                batch_items.append({"text": getattr(generation, "text", str(generation))})
        generations.append(batch_items)
    return _render_value(generations)


class AgentLogger(BaseCallbackHandler):
    """Print full LangChain/LangGraph agent activity to the terminal."""

    def on_chat_model_start(self, serialized, messages, **kwargs):
        if not verbose_enabled() or not llm_message_logging_enabled():
            return
        configure_agent_logging()
        model_name = serialized.get("name", "chat_model")
        logger.info("[LLMStart] Model=%s\n%s", model_name, _render_messages(messages))

    def on_llm_start(self, serialized, prompts, **kwargs):
        if not verbose_enabled() or not llm_message_logging_enabled():
            return
        configure_agent_logging()
        model_name = serialized.get("name", "llm")
        logger.info("[LLMStart] Model=%s\n%s", model_name, _render_value(prompts))

    def on_llm_end(self, response: LLMResult, **kwargs):
        if not verbose_enabled():
            return
        configure_agent_logging()
        logger.info("[LLMEnd]\n%s", _render_llm_result(response))

    def on_agent_action(self, action, **kwargs):
        if not verbose_enabled():
            return
        configure_agent_logging()
        logger.info("[AgentAction]\n%s", _render_value(action))

    def on_tool_start(self, serialized, input_str, **kwargs):
        if not verbose_enabled():
            return
        configure_agent_logging()
        tool_name = serialized.get("name", "unknown")
        logger.info("[ToolCall] Tool=%s\nInput:\n%s", tool_name, _render_value(input_str))

    def on_tool_end(self, output, **kwargs):
        if not verbose_enabled():
            return
        configure_agent_logging()
        raw = getattr(output, "content", None)
        if raw is None:
            raw = output
        logger.info("[ToolResult]\n%s", _render_value(raw))

    def on_agent_finish(self, finish, **kwargs):
        if not verbose_enabled():
            return
        configure_agent_logging()
        output = finish.return_values.get("output", "")
        logger.info("[AgentFinish]\n%s", _render_value(output))


agent_logger = AgentLogger()


def get_agent_callbacks() -> list[BaseCallbackHandler]:
    if not verbose_enabled():
        return []
    return [agent_logger]


def log_block(title: str, value: Any) -> None:
    if not verbose_enabled():
        return
    configure_agent_logging()
    logger.info("[%s]\n%s", title, _render_value(value))
